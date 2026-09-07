import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { html } from "./lib/html.js";
import { nowIso, isoPlusMinutes } from "./lib/datetime.js";
import { page, authedPage } from "./views/layout.js";
import { loginPage, registerPage } from "./views/auth.js";
import { admin } from "./admin.js";
import { one, all, run, getMeta, setMeta, ping } from "./db/queries.js";
import {
  hashPin,
  verifyPin,
  signSession,
  verifySession,
  setSessionCookie,
  clearAuthCookies,
  ensureCsrf,
  verifyCsrf,
  requireAuth,
  safeNext,
} from "./auth.js";

export const app = new Hono();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

// ─────────────────────────────────────────────
// 死活確認
// ─────────────────────────────────────────────
app.get("/healthz", async (c) => {
  let db = false;
  try {
    db = await ping(c.env.DB);
  } catch {
    db = false;
  }
  return c.json({ ok: db, service: "cleaning_schedule" }, db ? 200 : 503);
});

// ─────────────────────────────────────────────
// 登録
// ─────────────────────────────────────────────
async function registrationClosed(db) {
  if ((await getMeta(db, "registration_open", "1")) !== "1") return true;
  const cnt = await one(db, "SELECT COUNT(*) AS c FROM user");
  const max = parseInt(await getMeta(db, "max_users", "4"), 10) || 4;
  return (cnt?.c || 0) >= max;
}

app.get("/register", async (c) => {
  const token = c.req.query("token") || "";
  if (!c.env.SETUP_TOKEN || token !== c.env.SETUP_TOKEN) {
    return page(
      c,
      {
        title: "登録",
        appName: c.env.APP_NAME,
        body: html`<h1>403</h1><p class="muted">登録用リンクが正しくありません。</p>`,
      },
      403,
    );
  }
  const csrf = ensureCsrf(c);
  return registerPage(c, { token, csrf, closed: await registrationClosed(c.env.DB) });
});

app.post("/register", async (c) => {
  const body = await c.req.parseBody();
  if (!verifyCsrf(c, body)) return c.text("Bad Request", 400);

  const token = String(body.token || "");
  if (!c.env.SETUP_TOKEN || token !== c.env.SETUP_TOKEN) return c.text("Forbidden", 403);

  const csrf = ensureCsrf(c);
  if (await registrationClosed(c.env.DB)) {
    return registerPage(c, { token, csrf, closed: true });
  }

  const name = String(body.name || "").trim();
  const pin = String(body.pin || "");
  const pin2 = String(body.pin2 || "");
  const errs = [];
  if (name.length < 1 || name.length > 20) errs.push("表示名は1〜20文字で入力してください");
  if (!/^[0-9]{4,6}$/.test(pin)) errs.push("PIN は4〜6桁の数字で入力してください");
  if (pin !== pin2) errs.push("PIN（確認）が一致しません");
  if (!errs.length && (await one(c.env.DB, "SELECT id FROM user WHERE name = ?", name))) {
    errs.push("その表示名は既に使われています");
  }
  if (errs.length) {
    return registerPage(c, { token, csrf, error: errs.join(" / "), name }, 400);
  }

  const cntRow = await one(c.env.DB, "SELECT COUNT(*) AS c FROM user");
  const count = cntRow?.c || 0;
  const role = count === 0 ? "admin" : "member";

  const pinHash = await hashPin(pin);

  let uid;
  try {
    const meta = await run(
      c.env.DB,
      "INSERT INTO user (name, role, pin_hash, active, failed_count, created_at) VALUES (?, ?, ?, 1, 0, ?)",
      name,
      role,
      pinHash,
      nowIso(),
    );
    uid = meta.last_row_id;
  } catch (e) {
    // UNIQUE(name) 違反のみ「表示名重複」として扱う。それ以外は握りつぶさず onError へ。
    if (/UNIQUE|constraint/i.test(String(e?.message || e))) {
      return registerPage(c, { token, csrf, error: "その表示名は既に使われています", name }, 400);
    }
    throw e;
  }

  const max = parseInt(await getMeta(c.env.DB, "max_users", "4"), 10) || 4;
  if (count + 1 >= max) await setMeta(c.env.DB, "registration_open", "0");

  setSessionCookie(c, await signSession(c.env.SESSION_SECRET, { uid, role }));
  return c.redirect("/");
});

// ─────────────────────────────────────────────
// ログイン / ログアウト
// ─────────────────────────────────────────────
app.get("/login", async (c) => {
  const cnt = await one(c.env.DB, "SELECT COUNT(*) AS c FROM user");
  if (!cnt || cnt.c === 0) return c.redirect("/register");

  const token = getCookie(c, "sess");
  if (token && (await verifySession(c.env.SESSION_SECRET, token))) return c.redirect("/");

  const users = await all(c.env.DB, "SELECT id, name FROM user WHERE active = 1 ORDER BY id");
  const csrf = ensureCsrf(c);
  return loginPage(c, { users, csrf, next: safeNext(c.req.query("next")) });
});

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  if (!verifyCsrf(c, body)) return c.text("Bad Request", 400);

  const csrf = ensureCsrf(c);
  const next = safeNext(body.next);
  const users = await all(c.env.DB, "SELECT id, name FROM user WHERE active = 1 ORDER BY id");
  const fail = (error) => loginPage(c, { users, csrf, next, error }, 401);

  const uid = parseInt(body.user_id, 10);
  const pin = String(body.pin || "");
  if (!uid || !/^[0-9]+$/.test(pin)) return fail("名前と PIN を入力してください");

  const u = await one(
    c.env.DB,
    "SELECT id, name, role, active, pin_hash, failed_count, locked_until FROM user WHERE id = ?",
    uid,
  );
  if (!u || !u.active) return fail("ユーザーまたは PIN が違います");

  if (u.locked_until && u.locked_until > nowIso()) {
    return fail(`試行回数が上限に達しました。${LOCK_MINUTES}分ほど待ってから再度お試しください。`);
  }

  if (!(await verifyPin(pin, u.pin_hash))) {
    const fc = (u.failed_count || 0) + 1;
    const locked = fc >= MAX_FAILED ? isoPlusMinutes(LOCK_MINUTES) : null;
    await run(
      c.env.DB,
      "UPDATE user SET failed_count = ?, locked_until = ? WHERE id = ?",
      fc,
      locked,
      u.id,
    );
    return fail(
      locked
        ? `試行回数が上限に達しました。${LOCK_MINUTES}分後に再度お試しください。`
        : "ユーザーまたは PIN が違います",
    );
  }

  await run(
    c.env.DB,
    "UPDATE user SET failed_count = 0, locked_until = NULL WHERE id = ?",
    u.id,
  );
  setSessionCookie(c, await signSession(c.env.SESSION_SECRET, { uid: u.id, role: u.role }));
  return c.redirect(next || "/");
});

app.post("/logout", async (c) => {
  const body = await c.req.parseBody();
  if (!verifyCsrf(c, body)) return c.text("Bad Request", 400);
  clearAuthCookies(c);
  return c.redirect("/login");
});

// ─────────────────────────────────────────────
// ダッシュボード（P3 で清掃一覧に拡張）
// ─────────────────────────────────────────────
app.get("/", requireAuth(), (c) => {
  const user = c.get("user");
  return authedPage(c, {
    title: "清掃",
    active: "home",
    body: html`
      <h1>清掃予定</h1>
      <div class="card muted">
        まだ表示できる清掃予定がありません。<br />
        （P3: iCal 同期で自動生成されます）
      </div>
      ${user.role === "admin"
        ? html`<p><a class="btn secondary" href="/admin">管理メニュー</a></p>`
        : ""}
    `,
  });
});

// ─────────────────────────────────────────────
// 管理（物件・テンプレート・ユーザー管理）
// ─────────────────────────────────────────────
app.route("/admin", admin);

// ─────────────────────────────────────────────
// 404 / エラー
// ─────────────────────────────────────────────
app.notFound((c) =>
  page(
    c,
    {
      title: "ページが見つかりません",
      appName: c.env.APP_NAME,
      body: html`<h1>404</h1><p class="muted">ページが見つかりません。</p><p><a href="/">トップへ</a></p>`,
    },
    404,
  ),
);

app.onError((err, c) => {
  console.error("unhandled error:", err?.stack || err);
  return page(
    c,
    {
      title: "エラー",
      appName: c.env.APP_NAME,
      body: html`<h1>エラーが発生しました</h1><p class="muted">時間をおいて再度お試しください。</p>`,
    },
    500,
  );
});
