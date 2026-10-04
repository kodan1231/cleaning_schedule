-- 0014: 不足備品に「破損」を追加し、写真を付与できるようにする。
--   kind: shortage（不足・購入依頼） / damage（破損の報告）
--   写真は shortage_photo（メタ）と shortage_photo_blob（原寸・サムネ）に保存（photo/photo_blob と同じ仕組み）。
-- 適用:
--   npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0014_shortage_damage_photos.sql
--   npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0014_shortage_damage_photos.sql

ALTER TABLE shortage ADD COLUMN kind TEXT NOT NULL DEFAULT 'shortage' CHECK (kind IN ('shortage','damage'));

CREATE TABLE IF NOT EXISTS shortage_photo (
  id           INTEGER PRIMARY KEY,
  shortage_id  INTEGER NOT NULL REFERENCES shortage(id) ON DELETE CASCADE,
  size_bytes   INTEGER,
  uploaded_by  INTEGER NOT NULL REFERENCES user(id),
  uploaded_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shortage_photo_shortage ON shortage_photo(shortage_id, uploaded_at);

CREATE TABLE IF NOT EXISTS shortage_photo_blob (
  shortage_photo_id INTEGER NOT NULL REFERENCES shortage_photo(id) ON DELETE CASCADE,
  kind              TEXT    NOT NULL CHECK (kind IN ('full','thumb')),
  bytes             BLOB    NOT NULL,
  PRIMARY KEY (shortage_photo_id, kind)
);

UPDATE app_meta SET value = '14' WHERE key = 'schema_version';
