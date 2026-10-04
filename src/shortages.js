// 不足備品（購入依頼メモ）。清掃員が登録し、管理者が購入後に対応済みにする。
// 登録は清掃詳細から（POST /cleanings/:id/shortages・src/cleanings.js）。
// ここは一覧と対応操作。対応済み・未対応に戻す・削除は admin のみ。
// 参照: docs/02_基本設計書.md §4.5 / マイグレーション 0013

import { Hono } from "hono";
import { one, all, run } from "./db/queries.js";
import { requireAuth, verifyCsrf } from "./auth.js";
import { nowIso } from "./lib/datetime.js";
import { shortagesPage } from "./views/shortages.js";
import { html, raw } from "./lib/html.js";
import { authedPage } from "./views/layout.js";
import { isJpeg, MAX_FULL, MAX_THUMB } from "./photos.js";

export const shortages = new Hono();
shortages.use("*", requireAuth());

async function form(c) {
  const body = await c.req.parseBody();
  return verifyCsrf(c, body) ? body : null;
}
const badReq = (c) => c.text("Bad Request", 400);
const to = (path, msg) => path + (msg ? `?msg=${encodeURIComponent(msg)}` : "");
const isAdmin = (c) => c.get("user").role === "admin";
const csrf = (c) => html`<input type="hidden" name="_csrf" value="${c.get("csrf")}" />`;

async function resolveProperty(c, properties) {
  const raw = c.req.query("property") || "";
  const id = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  if (id && properties.some((p) => p.id === id)) return id;
  return properties[0]?.id ?? null;
}

// ─────────────────────────────────────────────
// GET /shortages  一覧（物件で絞り込み。未対応→対応済みの順）
// ─────────────────────────────────────────────
shortages.get("/", async (c) => {
  const db = c.env.DB;
  const properties = await all(db, "SELECT id, name FROM property WHERE active = 1 ORDER BY name, id");
  const propertyId = await resolveProperty(c, properties);
  let items = [];
  if (propertyId) {
    items = await all(
      db,
      `SELECT s.id, s.body, s.kind, s.status, s.created_at, s.done_at, s.cleaning_id,
              cu.name AS created_by_name, du.name AS done_by_name
         FROM shortage s
         JOIN user cu ON cu.id = s.created_by
         LEFT JOIN user du ON du.id = s.done_by
        WHERE s.property_id = ?
        ORDER BY (s.status = 'done'), s.created_at DESC, s.id DESC`,
      propertyId,
    );
    const photos = await all(
      db,
      `SELECT sp.id, sp.shortage_id, sp.uploaded_at, sp.uploaded_by, u.name AS uploaded_by_name
         FROM shortage_photo sp
         JOIN shortage s ON s.id = sp.shortage_id
         LEFT JOIN user u ON u.id = sp.uploaded_by
        WHERE s.property_id = ?
        ORDER BY sp.uploaded_at, sp.id`,
      propertyId,
    );
    const bySid = new Map();
    for (const p of photos) {
      if (!bySid.has(p.shortage_id)) bySid.set(p.shortage_id, []);
      bySid.get(p.shortage_id).push(p);
    }
    for (const it of items) it.photos = bySid.get(it.id) || [];
  }
  return shortagesPage(c, {
    properties,
    selectedPropertyId: propertyId,
    items,
    isAdmin: isAdmin(c),
    msg: c.req.query("msg"),
  });
});

// ─────────────────────────────────────────────
// POST /shortages/:id/done | reopen（admin のみ）
// ─────────────────────────────────────────────
async function setStatus(c, status, okMsg) {
  if (!isAdmin(c)) return c.text("Forbidden", 403);
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const s = await one(c.env.DB, "SELECT id, property_id FROM shortage WHERE id = ?", id);
  if (!s) return c.notFound();
  if (status === "done") {
    await run(
      c.env.DB,
      "UPDATE shortage SET status = 'done', done_by = ?, done_at = ? WHERE id = ?",
      c.get("user").id,
      nowIso(),
      id,
    );
  } else {
    await run(
      c.env.DB,
      "UPDATE shortage SET status = 'open', done_by = NULL, done_at = NULL WHERE id = ?",
      id,
    );
  }
  return c.redirect(to(`/shortages?property=${s.property_id}`, okMsg));
}

shortages.post("/:id/done", (c) => setStatus(c, "done", "対応済みにしました"));
shortages.post("/:id/reopen", (c) => setStatus(c, "open", "未対応に戻しました"));

// ─────────────────────────────────────────────
// POST /shortages/:id/delete（admin のみ）
// ─────────────────────────────────────────────
shortages.post("/:id/delete", async (c) => {
  if (!isAdmin(c)) return c.text("Forbidden", 403);
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const s = await one(c.env.DB, "SELECT id, property_id FROM shortage WHERE id = ?", id);
  if (!s) return c.notFound();
  await run(c.env.DB, "DELETE FROM shortage_photo_blob WHERE shortage_photo_id IN (SELECT id FROM shortage_photo WHERE shortage_id = ?)", id);
  await run(c.env.DB, "DELETE FROM shortage_photo WHERE shortage_id = ?", id);
  await run(c.env.DB, "DELETE FROM shortage WHERE id = ?", id);
  return c.redirect(to(`/shortages?property=${s.property_id}`, "削除しました"));
});

// ─────────────────────────────────────────────
// 写真: POST /shortages/:id/photos（全メンバー。フロントの .photo-form から1枚ずつ送る）
// ─────────────────────────────────────────────
shortages.post("/:id/photos", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const wantsJson = (c.req.header("accept") || "").includes("application/json");
  const bad = (msg, code = 400) =>
    wantsJson ? c.json({ ok: false, error: msg }, code) : c.redirect(to("/shortages", msg));
  const body = await form(c);
  if (!body) return bad("不正なリクエストです", 400);
  const s = await one(c.env.DB, "SELECT id, property_id FROM shortage WHERE id = ?", id);
  if (!s) return c.notFound();

  const full = body.full;
  if (!full || typeof full === "string" || typeof full.arrayBuffer !== "function") {
    return bad("画像ファイルを選択してください", 400);
  }
  const fullBuf = new Uint8Array(await full.arrayBuffer());
  if (!isJpeg(fullBuf)) return bad("JPEG 画像のみアップロードできます", 415);
  if (fullBuf.byteLength > MAX_FULL) return bad("画像が大きすぎます", 413);

  let thumbBuf = fullBuf;
  const thumb = body.thumb;
  if (thumb && typeof thumb !== "string" && typeof thumb.arrayBuffer === "function") {
    const tb = new Uint8Array(await thumb.arrayBuffer());
    if (isJpeg(tb) && tb.byteLength <= MAX_THUMB) thumbBuf = tb;
  }

  const meta = await run(
    c.env.DB,
    "INSERT INTO shortage_photo (shortage_id, size_bytes, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?)",
    id,
    fullBuf.byteLength,
    c.get("user").id,
    nowIso(),
  );
  await run(c.env.DB, "INSERT INTO shortage_photo_blob (shortage_photo_id, kind, bytes) VALUES (?, 'full', ?)", meta.last_row_id, fullBuf);
  await run(c.env.DB, "INSERT INTO shortage_photo_blob (shortage_photo_id, kind, bytes) VALUES (?, 'thumb', ?)", meta.last_row_id, thumbBuf);

  return wantsJson
    ? c.json({ ok: true, photoId: meta.last_row_id })
    : c.redirect(to(`/shortages?property=${s.property_id}`, "写真を追加しました"));
});

// 写真の配信（?thumb=1 でサムネ）と拡大ページ（?view=1）
shortages.get("/photos/:pid", async (c) => {
  const pid = parseInt(c.req.param("pid"), 10);
  const photo = await one(
    c.env.DB,
    `SELECT sp.id, sp.uploaded_at, sp.uploaded_by, sp.shortage_id, s.property_id, s.body,
            u.name AS uploaded_by_name
       FROM shortage_photo sp
       JOIN shortage s ON s.id = sp.shortage_id
       LEFT JOIN user u ON u.id = sp.uploaded_by
      WHERE sp.id = ?`,
    pid,
  );
  if (!photo) return c.notFound();

  if (c.req.query("view")) {
    const me = c.get("user");
    const canDelete = photo.uploaded_by === me.id || me.role === "admin";
    return authedPage(c, {
      title: "写真",
      body: html`
        <p><a href="/shortages?property=${photo.property_id}">&larr; 不足備品へ戻る</a></p>
        <h1>${photo.body}</h1>
        <div class="photo-view">
          <img src="/shortages/photos/${photo.id}?v=${encodeURIComponent(photo.uploaded_at)}" alt="写真" />
        </div>
        <p class="muted sm">${photo.uploaded_by_name || "?"}・${photo.uploaded_at}</p>
        ${canDelete
          ? html`
              <form method="post" action="/shortages/photos/${photo.id}/delete"
                    onsubmit="return confirm('この写真を削除しますか？')">
                ${csrf(c)}
                <button type="submit" class="secondary danger">写真を削除</button>
              </form>
            `
          : raw("")}
      `,
    });
  }

  const kind = c.req.query("thumb") ? "thumb" : "full";
  let row = await one(c.env.DB, "SELECT bytes FROM shortage_photo_blob WHERE shortage_photo_id = ? AND kind = ?", pid, kind);
  if (!row && kind === "full") {
    row = await one(c.env.DB, "SELECT bytes FROM shortage_photo_blob WHERE shortage_photo_id = ? AND kind = 'thumb'", pid);
  }
  if (!row || row.bytes == null) return c.notFound();
  let bytes = row.bytes;
  if (Array.isArray(bytes)) bytes = new Uint8Array(bytes);
  else if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  const etag = `"sp-${pid}-${kind}-${photo.uploaded_at}"`;
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);
  return c.body(bytes, 200, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "private, max-age=86400",
    ETag: etag,
  });
});

// 写真の削除（登録者本人 or admin）
shortages.post("/photos/:pid/delete", async (c) => {
  const pid = parseInt(c.req.param("pid"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const photo = await one(
    c.env.DB,
    `SELECT sp.id, sp.uploaded_by, s.property_id FROM shortage_photo sp JOIN shortage s ON s.id = sp.shortage_id WHERE sp.id = ?`,
    pid,
  );
  if (!photo) return c.notFound();
  const me = c.get("user");
  if (photo.uploaded_by !== me.id && me.role !== "admin") return c.text("Forbidden", 403);
  await run(c.env.DB, "DELETE FROM shortage_photo_blob WHERE shortage_photo_id = ?", pid);
  await run(c.env.DB, "DELETE FROM shortage_photo WHERE id = ?", pid);
  return c.redirect(to(`/shortages?property=${photo.property_id}`, "写真を削除しました"));
});
