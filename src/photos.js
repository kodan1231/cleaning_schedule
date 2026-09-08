// 写真エビデンス（P6）。クライアントで縮小済みの JPEG を D1 BLOB に保存・配信・削除。
// 参照: docs/02 §7 / §4.3 / docs/01 FR-22〜27

import { Hono } from "hono";
import { one, all, run } from "./db/queries.js";
import { requireAuth, verifyCsrf } from "./auth.js";
import { nowIso } from "./lib/datetime.js";
import { logEvent } from "./lib/events.js";
import { html, raw } from "./lib/html.js";
import { page } from "./views/layout.js";

const MAX_FULL = 1_500_000; // 1.5MB（D1 の行/BLOB 上限 2,000,000 の内側）
const MAX_THUMB = 300_000;

async function form(c) {
  const body = await c.req.parseBody();
  return verifyCsrf(c, body) ? body : null;
}

// ─────────────────────────────────────────────
// アップロード: POST /cleanings/:id/photos
//   fetch（JSON 期待）でも通常フォームでも動く
// ─────────────────────────────────────────────
export async function uploadPhoto(c) {
  const id = parseInt(c.req.param("id"), 10);
  const wantsJson = (c.req.header("accept") || "").includes("application/json");
  const body = await form(c);
  const bad = (msg, code = 400) =>
    wantsJson ? c.json({ ok: false, error: msg }, code) : c.redirect(`/cleanings/${id}?msg=${encodeURIComponent(msg)}`);
  if (!body) return bad("不正なリクエストです", 400);

  const cl = await one(
    c.env.DB,
    "SELECT id, property_id, status FROM cleaning WHERE id = ?",
    id,
  );
  if (!cl) return c.notFound();
  if (cl.status === "cancelled") return bad("キャンセル済みの清掃には追加できません", 409);

  let itemId = null;
  if (body.item_id) {
    const it = await one(
      c.env.DB,
      "SELECT id FROM checklist_item WHERE id = ? AND cleaning_id = ?",
      parseInt(String(body.item_id), 10),
      id,
    );
    if (!it) return bad("項目が見つかりません", 400);
    itemId = it.id;
  }

  const full = body.full;
  const thumb = body.thumb;
  if (!full || typeof full === "string" || typeof full.arrayBuffer !== "function") {
    return bad("画像ファイルを選択してください", 400);
  }
  const fullBuf = new Uint8Array(await full.arrayBuffer());
  if (!isJpeg(fullBuf)) return bad("JPEG 画像のみアップロードできます（対応ブラウザで撮影してください）", 415);
  if (fullBuf.byteLength > MAX_FULL) return bad("画像が大きすぎます。撮り直してください", 413);

  let thumbBuf = fullBuf;
  if (thumb && typeof thumb !== "string" && typeof thumb.arrayBuffer === "function") {
    const tb = new Uint8Array(await thumb.arrayBuffer());
    if (isJpeg(tb) && tb.byteLength <= MAX_THUMB) thumbBuf = tb;
  }

  const caption = String(body.caption || "").trim().slice(0, 200) || null;
  const meta = await run(
    c.env.DB,
    `INSERT INTO photo
       (property_id, cleaning_id, checklist_item_id, storage, content_type, size_bytes, caption, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, 'd1', 'image/jpeg', ?, ?, ?, ?)`,
    cl.property_id,
    id,
    itemId,
    fullBuf.byteLength,
    caption,
    c.get("user").id,
    nowIso(),
  );
  const photoId = meta.last_row_id;
  await run(
    c.env.DB,
    "INSERT INTO photo_blob (photo_id, kind, bytes) VALUES (?, 'full', ?)",
    photoId,
    fullBuf,
  );
  await run(
    c.env.DB,
    "INSERT INTO photo_blob (photo_id, kind, bytes) VALUES (?, 'thumb', ?)",
    photoId,
    thumbBuf,
  );
  await logEvent(c.env.DB, id, "photo_add", c.get("user").id, itemId ? "項目写真" : null);

  return wantsJson
    ? c.json({ ok: true, photoId })
    : c.redirect(`/cleanings/${id}?msg=${encodeURIComponent("写真を追加しました")}`);
}

/** JPEG マジックナンバー（FF D8 FF） */
function isJpeg(u8) {
  return u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff;
}

// ─────────────────────────────────────────────
// /photos/*
// ─────────────────────────────────────────────
export const photos = new Hono();
photos.use("*", requireAuth());

photos.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const kind = c.req.query("thumb") ? "thumb" : "full";
  const photo = await one(
    c.env.DB,
    `SELECT p.id, p.caption, p.uploaded_by, p.uploaded_at, p.cleaning_id,
            u.name AS uploaded_by_name
     FROM photo p LEFT JOIN user u ON u.id = p.uploaded_by
     WHERE p.id = ?`,
    id,
  );
  if (!photo) return c.notFound();

  if (c.req.query("view")) {
    const me = c.get("user");
    const canDelete = photo.uploaded_by === me.id || me.role === "admin";
    return page(c, {
      title: "写真",
      appName: c.env.APP_NAME,
      user: me,
      csrf: c.get("csrf"),
      body: html`
        <p><a href="/cleanings/${photo.cleaning_id}">&larr; 清掃へ戻る</a></p>
        <div class="photo-view">
          <img src="/photos/${photo.id}" alt="${photo.caption || "写真"}" />
        </div>
        ${photo.caption ? html`<p>${photo.caption}</p>` : raw("")}
        <p class="muted sm">${photo.uploaded_by_name || "?"}・${photo.uploaded_at}</p>
        ${canDelete
          ? html`
              <form method="post" action="/photos/${photo.id}/delete"
                    onsubmit="return confirm('この写真を削除しますか？')">
                <input type="hidden" name="_csrf" value="${c.get("csrf")}" />
                <button type="submit" class="secondary danger">写真を削除</button>
              </form>
            `
          : raw("")}
      `,
    });
  }

  const row = await one(
    c.env.DB,
    "SELECT bytes FROM photo_blob WHERE photo_id = ? AND kind = ?",
    id,
    kind,
  );
  if (!row || row.bytes == null) return c.notFound();

  let bytes = row.bytes;
  if (Array.isArray(bytes)) bytes = new Uint8Array(bytes);
  else if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);

  const etag = `"${id}-${kind}"`;
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);
  return c.body(bytes, 200, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "private, max-age=86400",
    ETag: etag,
  });
});

photos.post("/:id/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return c.text("Bad Request", 400);
  const photo = await one(
    c.env.DB,
    "SELECT id, cleaning_id, checklist_item_id, uploaded_by FROM photo WHERE id = ?",
    id,
  );
  if (!photo) return c.notFound();
  const me = c.get("user");
  if (photo.uploaded_by !== me.id && me.role !== "admin") return c.text("Forbidden", 403);

  await run(c.env.DB, "DELETE FROM photo_blob WHERE photo_id = ?", id);
  await run(c.env.DB, "DELETE FROM photo WHERE id = ?", id);
  await logEvent(c.env.DB, photo.cleaning_id, "photo_delete", me.id, null);
  return c.redirect(`/cleanings/${photo.cleaning_id}?msg=${encodeURIComponent("写真を削除しました")}`);
});

/** 清掃の写真を全部取得（詳細画面用）。checklist_item_id ごとに分けやすい形 */
export async function loadPhotos(db, cleaningId) {
  return all(
    db,
    `SELECT p.id, p.checklist_item_id, p.caption, p.uploaded_at, u.name AS uploaded_by_name
     FROM photo p LEFT JOIN user u ON u.id = p.uploaded_by
     WHERE p.cleaning_id = ?
     ORDER BY p.uploaded_at ASC, p.id ASC`,
    cleaningId,
  );
}
