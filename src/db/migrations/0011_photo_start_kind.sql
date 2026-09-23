-- 0011: 作業開始時の「現状写真」機能。
--   photo に種別（kind）と間取り名（room_name）を追加。
--   kind='item'（既定・従来のチェック項目ひもづけ写真） / 'start'（作業開始時に部屋ごとに撮る現状写真）。
--   room_name は kind='start' の写真がどの間取りのものかを表す（checklist_item.room_name と同じ体系の
--   スナップショット時点の名前。checklist_item_id を持たないためこちらに直接持たせる）。
-- 適用:
--   npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0011_photo_start_kind.sql
--   npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0011_photo_start_kind.sql

ALTER TABLE photo ADD COLUMN kind TEXT NOT NULL DEFAULT 'item' CHECK (kind IN ('item','start'));
ALTER TABLE photo ADD COLUMN room_name TEXT;

UPDATE app_meta SET value = '11' WHERE key = 'schema_version';
