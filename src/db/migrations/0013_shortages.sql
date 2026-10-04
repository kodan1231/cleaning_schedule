-- 0013: 在庫管理（0012 supply / supply_log）を廃止し、「不足備品」（購入依頼メモ）に置き換える。
--   清掃員が清掃中に不足した備品を短い文章で登録 → 管理者が購入後に「対応済み」にする。
--   在庫数の管理は行わない（詳細な在庫管理は不要とのため）。
-- 適用:
--   npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0013_shortages.sql
--   npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0013_shortages.sql

CREATE TABLE IF NOT EXISTS shortage (
  id          INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  cleaning_id INTEGER REFERENCES cleaning(id) ON DELETE SET NULL, -- 登録元の清掃（任意・参照用）
  body        TEXT    NOT NULL,                                   -- 例: トイレットペーパーが残り2個
  status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_by  INTEGER NOT NULL REFERENCES user(id),
  created_at  TEXT    NOT NULL,
  done_by     INTEGER REFERENCES user(id),
  done_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_shortage_property_status ON shortage(property_id, status, created_at);

DROP TABLE IF EXISTS supply_log;
DROP TABLE IF EXISTS supply;

UPDATE app_meta SET value = '13' WHERE key = 'schema_version';
