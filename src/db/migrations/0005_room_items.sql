-- 0005: 間取りごとの追加チェック項目（共有テンプレに含めない部屋固有の項目）。
--   例: 1階トイレと2階トイレで作業が違う、洋室でも部屋ごとに少し違う 等。
--   清掃生成時に〈テンプレ項目 → その間取りの room_item〉の順で checklist_item に展開される。
--   適用:
--     npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0005_room_items.sql
--     npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0005_room_items.sql

CREATE TABLE IF NOT EXISTS room_item (
  id          INTEGER PRIMARY KEY,
  room_id     INTEGER NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  label       TEXT    NOT NULL,
  needs_photo INTEGER NOT NULL DEFAULT 0,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_room_item_room ON room_item(room_id, sort_order);

UPDATE app_meta SET value = '5' WHERE key = 'schema_version';
