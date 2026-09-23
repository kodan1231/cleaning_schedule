// 写真の容量対策（docs/02 §7.3）。
// アップロードから一定日数が経った写真は、フル画像（photo_blob.kind='full'）だけを削除し、
// サムネイル（'thumb'）は残す。閲覧時はフルが無ければサムネにフォールバックする（src/photos.js）。
// 毎日の Cron 同期（ical/sync.js runScheduledSync）の最後に呼ぶ。

import { run, one } from "../db/queries.js";
import { nowIso } from "./datetime.js";

export const RETENTION_DAYS = 30;

/**
 * アップロードから RETENTION_DAYS 日以上経過した写真の full BLOB を削除する。
 * sync_log にも結果を残す（property_id は NULL。管理画面の同期ログに「—」として並ぶ）。
 * @returns 削除した件数
 */
export async function purgeOldFullPhotos(db) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  const before = await one(
    db,
    `SELECT COUNT(*) AS n FROM photo_blob b
       JOIN photo p ON p.id = b.photo_id
      WHERE b.kind = 'full' AND p.uploaded_at < ?`,
    cutoff,
  );
  const n = before?.n || 0;
  if (n > 0) {
    await run(
      db,
      `DELETE FROM photo_blob WHERE kind = 'full' AND photo_id IN (
         SELECT id FROM photo WHERE uploaded_at < ?
       )`,
      cutoff,
    );
  }

  try {
    await run(
      db,
      `INSERT INTO sync_log
         (property_id, run_at, result, reservations_seen, cleanings_created, cleanings_updated, message)
       VALUES (NULL, ?, ?, 0, 0, 0, ?)`,
      nowIso(),
      n > 0 ? "ok" : "no_change",
      n > 0
        ? `写真圧縮: ${n}件のフル画像を削除（アップロードから${RETENTION_DAYS}日超・サムネイルは保持）`
        : "写真圧縮: 対象なし",
    );
  } catch (e) {
    console.error("photo purge sync_log 書き込み失敗", e);
  }

  return n;
}
