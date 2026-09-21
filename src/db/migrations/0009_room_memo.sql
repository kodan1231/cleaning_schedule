-- 0009: 間取り（部屋）ごとの引き継ぎメモ。
--   清掃（cleaning.note）ではなく部屋（room）にぶら下げることで、次回以降の清掃にも
--   自動的に引き継がれる。清掃詳細の各部屋ブロックから編集する（最後に保存した内容が有効）。
-- 適用:
--   npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0009_room_memo.sql
--   npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0009_room_memo.sql

ALTER TABLE room ADD COLUMN memo TEXT;
ALTER TABLE room ADD COLUMN memo_updated_by INTEGER REFERENCES user(id);
ALTER TABLE room ADD COLUMN memo_updated_at TEXT;

UPDATE app_meta SET value = '9' WHERE key = 'schema_version';
