-- 0008: sync_log.result に 'no_change'（差分なし）を追加。
--   iCal 同期で予約・清掃・チェックリストのいずれにも変更がなかった回を
--   'ok'（変更を反映した）と区別できるようにする。D1 へのアクセス削減
--   （差分がない予約・チェック項目は UPDATE をスキップする改修）に合わせた変更。
--   SQLite は CHECK 制約の変更を直接サポートしないため、テーブルを作り直す。
-- 適用:
--   npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0008_sync_log_no_change.sql
--   npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0008_sync_log_no_change.sql

ALTER TABLE sync_log RENAME TO sync_log_old;

CREATE TABLE sync_log (
  id                INTEGER PRIMARY KEY,
  property_id       INTEGER REFERENCES property(id) ON DELETE CASCADE,
  run_at            TEXT    NOT NULL,
  result            TEXT    NOT NULL CHECK (result IN ('ok','no_change','error')),
  reservations_seen INTEGER NOT NULL DEFAULT 0,
  cleanings_created INTEGER NOT NULL DEFAULT 0,
  cleanings_updated INTEGER NOT NULL DEFAULT 0,
  message           TEXT
);
CREATE INDEX IF NOT EXISTS idx_synclog_prop_time ON sync_log(property_id, run_at DESC);

INSERT INTO sync_log
  (id, property_id, run_at, result, reservations_seen, cleanings_created, cleanings_updated, message)
SELECT id, property_id, run_at, result, reservations_seen, cleanings_created, cleanings_updated, message
FROM sync_log_old;

DROP TABLE sync_log_old;

UPDATE app_meta SET value = '8' WHERE key = 'schema_version';
