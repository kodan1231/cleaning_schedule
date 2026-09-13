// 間取りの参考写真（完成イメージ）の配信・閲覧。アップロード/削除は管理画面（admin.js）側。

import { Hono } from "hono";
import { one } from "./db/queries.js";
import { requireAuth } from "./auth.js";
import { html, raw } from "./lib/html.js";
import { authedPage } from "./views/layout.js";

export const roomPhotos = new Hono();
roomPhotos.use("*", requireAuth());

roomPhotos.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const kind = c.req.query("thumb") ? "thumb" : "full";
  const photo = await one(
    c.env.DB,
    `SELECT rp.id, rp.caption, rp.uploaded_at, r.id AS room_id, r.name AS room_name, r.property_id,
            u.name AS uploaded_by_name
     FROM room_photo rp
     JOIN room r ON r.id = rp.room_id
     LEFT JOIN user u ON u.id = rp.uploaded_by
     WHERE rp.id = ?`,
    id,
  );
  if (!photo) return c.notFound();

  if (c.req.query("view")) {
    const me = c.get("user");
    return authedPage(c, {
      title: "参考写真",
      body: html`
        <p><a href="javascript:history.back()">&larr; 戻る</a></p>
        <h1>${photo.room_name} の参考写真</h1>
        <div class="photo-view">
          <img src="/room-photos/${photo.id}" alt="${photo.caption || "参考写真"}" />
        </div>
        ${photo.caption ? html`<p>${photo.caption}</p>` : raw("")}
        <p class="muted sm">${photo.uploaded_by_name || "?"}・${photo.uploaded_at}</p>
        ${me.role === "admin"
          ? html`
              <form method="post"
                    action="/admin/properties/${photo.property_id}/rooms/${photo.room_id}/photos/${photo.id}/delete"
                    onsubmit="return confirm('この参考写真を削除しますか？')">
                <input type="hidden" name="_csrf" value="${c.get("csrf")}" />
                <button type="submit" class="secondary danger">削除する</button>
              </form>
            `
          : raw("")}
      `,
    });
  }

  const row = await one(
    c.env.DB,
    "SELECT bytes FROM room_photo_blob WHERE room_photo_id = ? AND kind = ?",
    id,
    kind,
  );
  if (!row || row.bytes == null) return c.notFound();

  let bytes = row.bytes;
  if (Array.isArray(bytes)) bytes = new Uint8Array(bytes);
  else if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);

  const etag = `"rp-${id}-${kind}"`;
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);
  return c.body(bytes, 200, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "private, max-age=86400",
    ETag: etag,
  });
});
