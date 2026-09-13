-- 0006: 間取りの参考写真（完成イメージを複数枚・キャプション付きで登録）。
--   物件の間取り設定時に「最終的にどう仕上がっていればいいか」を確認できるようにする。
--   既存の photo/photo_blob（清掃エビデンス）と同じ D1 BLOB 方式。
--   適用:
--     npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0006_room_photos.sql
--     npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0006_room_photos.sql

CREATE TABLE IF NOT EXISTS room_photo (
  id          INTEGER PRIMARY KEY,
  room_id     INTEGER NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  caption     TEXT,
  size_bytes  INTEGER,
  uploaded_by INTEGER REFERENCES user(id),
  uploaded_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room_photo_room ON room_photo(room_id, uploaded_at);

CREATE TABLE IF NOT EXISTS room_photo_blob (
  room_photo_id INTEGER NOT NULL REFERENCES room_photo(id) ON DELETE CASCADE,
  kind          TEXT    NOT NULL CHECK (kind IN ('full','thumb')),
  bytes         BLOB    NOT NULL,
  PRIMARY KEY (room_photo_id, kind)
);

UPDATE app_meta SET value = '6' WHERE key = 'schema_version';
