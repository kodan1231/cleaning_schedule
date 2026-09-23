-- 0012: 備品（消耗品）の在庫管理。
--   物件ごとに備品マスタ（supply）を持ち、在庫数の更新履歴を supply_log に残す。
-- 適用:
--   npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0012_supplies.sql
--   npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0012_supplies.sql

CREATE TABLE IF NOT EXISTS supply (
  id          INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  unit        TEXT,                      -- 例: 本・個・L（任意）
  sort_order  INTEGER NOT NULL DEFAULT 0,
  stock       INTEGER NOT NULL DEFAULT 0, -- 現在の在庫数（最新の supply_log を反映したスナップショット）
  note        TEXT,                       -- 最新更新時の備考
  updated_by  INTEGER REFERENCES user(id),
  updated_at  TEXT,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supply_property ON supply(property_id, sort_order);

-- 在庫数の更新履歴（追記のみ・不変）
CREATE TABLE IF NOT EXISTS supply_log (
  id         INTEGER PRIMARY KEY,
  supply_id  INTEGER NOT NULL REFERENCES supply(id) ON DELETE CASCADE,
  stock      INTEGER NOT NULL,           -- 更新後の在庫数
  note       TEXT,
  changed_by INTEGER REFERENCES user(id),
  changed_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supply_log_supply ON supply_log(supply_id, changed_at DESC);

UPDATE app_meta SET value = '12' WHERE key = 'schema_version';
