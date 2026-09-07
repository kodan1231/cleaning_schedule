import { Hono } from "hono";
import { html } from "./lib/html.js";
import { page } from "./views/layout.js";
import { ping } from "./db/queries.js";

export const app = new Hono();

// ── 死活確認 ───────────────────────────────
app.get("/healthz", async (c) => {
  let db = false;
  try {
    db = await ping(c.env.DB);
  } catch {
    db = false;
  }
  return c.json({ ok: db, service: "cleaning_schedule" }, db ? 200 : 503);
});

// ── トップ（P1 で認証・ダッシュボードに置き換え）──
app.get("/", (c) => {
  return page({
    title: "セットアップ中",
    appName: c.env.APP_NAME,
    body: html`
      <h1>民泊清掃</h1>
      <p class="muted">基盤フェーズ（P0）。認証と画面は次フェーズで実装します。</p>
      <p><a href="/healthz">/healthz</a></p>
    `,
  });
});

// ── 404 ───────────────────────────────────
app.notFound((c) =>
  page(
    {
      title: "ページが見つかりません",
      appName: c.env.APP_NAME,
      body: html`<h1>404</h1><p class="muted">ページが見つかりません。</p><p><a href="/">トップへ</a></p>`,
    },
    404,
  ),
);

// ── エラー ─────────────────────────────────
app.onError((err, c) => {
  console.error("unhandled error:", err?.stack || err);
  return page(
    {
      title: "エラー",
      appName: c.env.APP_NAME,
      body: html`<h1>エラーが発生しました</h1><p class="muted">時間をおいて再度お試しください。</p>`,
    },
    500,
  );
});
