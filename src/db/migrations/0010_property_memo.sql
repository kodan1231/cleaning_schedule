-- 0010: 物件ごとの全体メモ（引き継ぎ）。
--   清掃詳細ページ上部のメモを、清掃ごと（cleaning.note）ではなく物件（property）に
--   保存し、次回以降の清掃にも引き継がれるようにする。部屋メモ（0009）と同じ方式。
--   （property.note は管理画面用の物件メモで別物のため、列名は memo とする）
--   既存の清掃メモは、物件ごとに最新（清掃日が新しい）の1件を初期値として引き継ぐ。
-- 適用:
--   npx wrangler d1 execute cleaning_schedule --local  --file src/db/migrations/0010_property_memo.sql
--   npx wrangler d1 execute cleaning_schedule --remote --file src/db/migrations/0010_property_memo.sql

ALTER TABLE property ADD COLUMN memo TEXT;
ALTER TABLE property ADD COLUMN memo_updated_by INTEGER REFERENCES user(id);
ALTER TABLE property ADD COLUMN memo_updated_at TEXT;

UPDATE property SET memo = (
  SELECT c.note FROM cleaning c
   WHERE c.property_id = property.id AND c.note IS NOT NULL AND c.note != ''
   ORDER BY c.clean_date DESC, c.id DESC LIMIT 1
);

UPDATE app_meta SET value = '10' WHERE key = 'schema_version';
