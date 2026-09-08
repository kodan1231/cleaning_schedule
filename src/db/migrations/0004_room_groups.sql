-- 0004: 間取りの「グループ（階など）」。表示の折りたたみ用。
--   適用:
--     npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0004_room_groups.sql
--     npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0004_room_groups.sql

ALTER TABLE room ADD COLUMN group_label TEXT;

-- 清掃スナップショットにもグループ名を持たせる（詳細画面で room を JOIN せず表示するため）
ALTER TABLE checklist_item ADD COLUMN room_group TEXT;

UPDATE app_meta SET value = '4' WHERE key = 'schema_version';
