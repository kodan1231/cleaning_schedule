-- 0002: 作業イベントログ（実作業時間の計測・履歴）
-- 適用: npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0002_cleaning_events.sql
--       npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0002_cleaning_events.sql

CREATE TABLE IF NOT EXISTS cleaning_event (
  id          INTEGER PRIMARY KEY,
  cleaning_id INTEGER NOT NULL REFERENCES cleaning(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  user_id     INTEGER REFERENCES user(id),
  at          TEXT    NOT NULL,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_cleanevt ON cleaning_event(cleaning_id, at);

UPDATE app_meta SET value = '2' WHERE key = 'schema_version';
