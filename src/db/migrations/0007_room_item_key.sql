-- 0007: 部屋専用項目（room_item）に安定キーを追加。
--   テンプレ項目と同じ仕組みで、テンプレ/間取り変更後の再生成時に
--   「チェック済み項目だけ保持」するための対応付けに使う（ラベルを変更しても追跡できる）。
--   適用:
--     npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0007_room_item_key.sql
--     npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0007_room_item_key.sql

ALTER TABLE room_item ADD COLUMN item_key TEXT;
UPDATE room_item SET item_key = 'ri_' || lower(hex(randomblob(8))) WHERE item_key IS NULL;

UPDATE app_meta SET value = '7' WHERE key = 'schema_version';
