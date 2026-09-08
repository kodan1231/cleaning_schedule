-- 0003: 間取り（部屋）モデル導入
--   物件 1-N 間取り、間取り 1 テンプレート、清掃生成時に全間取りを展開。
--   適用:
--     npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0003_rooms.sql
--     npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0003_rooms.sql

-- 間取り（部屋）: 物件 1-N。各間取りにテンプレート1つ。
CREATE TABLE IF NOT EXISTS room (
  id          INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  template_id INTEGER REFERENCES checklist_template(id),
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room_property ON room(property_id, sort_order);

-- テンプレートは名前付き共有プールに（is_base / property_id は不使用。列は残置）。
UPDATE checklist_template SET name = '（サンプル）標準' WHERE id = 1 AND is_base = 1;

-- checklist_template_item: area_label を廃止（列だけ削除。既存項目は保持）。
ALTER TABLE checklist_template_item DROP COLUMN area_label;

-- checklist_item (清掃スナップショット): area_label → room_name / room_sort。作り直し（本番は清掃のチェック項目0）。
DROP TABLE IF EXISTS checklist_item;
CREATE TABLE checklist_item (
  id          INTEGER PRIMARY KEY,
  cleaning_id INTEGER NOT NULL REFERENCES cleaning(id) ON DELETE CASCADE,
  room_name   TEXT    NOT NULL,
  room_sort   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  item_key    TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  needs_photo INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  checked     INTEGER NOT NULL DEFAULT 0,
  checked_by  INTEGER REFERENCES user(id),
  checked_at  TEXT
);
CREATE INDEX idx_item_cleaning ON checklist_item(cleaning_id, room_sort, sort_order);

-- 物件の単一テンプレ割当は廃止（property.template_id 列は残置・不使用）。

UPDATE app_meta SET value = '3' WHERE key = 'schema_version';
