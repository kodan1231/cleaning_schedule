-- cleaning_schedule 初期スキーマ（マイグレーション 0001）
-- 参照: docs/02_基本設計書.md §3
-- 適用: npm run db:local / npm run db:remote

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────
-- ユーザー（初期は空。各自が /register でセルフ登録。02 §6.1）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user (
  id           INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL UNIQUE,
  role         TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  pin_hash     TEXT    NOT NULL,          -- pbkdf2$<iter>$<salt_b64>$<hash_b64>
  active       INTEGER NOT NULL DEFAULT 1,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,                      -- ISO8601 UTC
  created_at   TEXT    NOT NULL
);

-- ─────────────────────────────────────────────
-- 物件
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  ical_url      TEXT    NOT NULL,         -- 機微。UI はマスク、ログ出力禁止
  active        INTEGER NOT NULL DEFAULT 1,
  checkout_time TEXT    NOT NULL DEFAULT '10:00',
  template_id   INTEGER REFERENCES checklist_template(id),
  note          TEXT,
  created_at    TEXT    NOT NULL
);

-- ─────────────────────────────────────────────
-- チェックリストテンプレート
--   is_base=1: 共通ベース（property_id=NULL）
--   物件用   : property_id を持つ
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_template (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  is_base     INTEGER NOT NULL DEFAULT 0,
  property_id INTEGER REFERENCES property(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_template_item (
  id          INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES checklist_template(id) ON DELETE CASCADE,
  area_label  TEXT    NOT NULL,           -- 部屋 / エリア
  sort_order  INTEGER NOT NULL DEFAULT 0,
  item_key    TEXT    NOT NULL,           -- テンプレ内で一意な安定キー
  label       TEXT    NOT NULL,
  needs_photo INTEGER NOT NULL DEFAULT 0,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_tpl_item_tpl ON checklist_template_item(template_id, sort_order);

-- ─────────────────────────────────────────────
-- 予約（iCal 同期結果）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservation (
  id            INTEGER PRIMARY KEY,
  property_id   INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  ical_uid      TEXT    NOT NULL,
  checkin_date  TEXT    NOT NULL,         -- YYYY-MM-DD
  checkout_date TEXT    NOT NULL,         -- YYYY-MM-DD（清掃日）
  guest_hint    TEXT,
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  raw_text      TEXT,                     -- VEVENT 原文（画面非表示）
  synced_at     TEXT    NOT NULL,
  UNIQUE (property_id, ical_uid)
);
CREATE INDEX IF NOT EXISTS idx_resv_prop_checkout ON reservation(property_id, checkout_date);

-- ─────────────────────────────────────────────
-- 清掃タスク
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cleaning (
  id             INTEGER PRIMARY KEY,
  property_id    INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  reservation_id INTEGER REFERENCES reservation(id) ON DELETE SET NULL,
  clean_date     TEXT    NOT NULL,        -- YYYY-MM-DD
  source         TEXT    NOT NULL DEFAULT 'ical' CHECK (source IN ('ical','manual')),
  status         TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','in_progress','done','cancelled')),
  started_by     INTEGER REFERENCES user(id),
  started_at     TEXT,
  completed_by   INTEGER REFERENCES user(id),
  completed_at   TEXT,
  note           TEXT,
  created_at     TEXT    NOT NULL,
  UNIQUE (property_id, clean_date, reservation_id)
);
CREATE INDEX IF NOT EXISTS idx_cleaning_date ON cleaning(clean_date);
CREATE INDEX IF NOT EXISTS idx_cleaning_prop_status ON cleaning(property_id, status);

-- ─────────────────────────────────────────────
-- チェック項目（テンプレからスナップショット生成）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_item (
  id          INTEGER PRIMARY KEY,
  cleaning_id INTEGER NOT NULL REFERENCES cleaning(id) ON DELETE CASCADE,
  area_label  TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  item_key    TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  needs_photo INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  checked     INTEGER NOT NULL DEFAULT 0,
  checked_by  INTEGER REFERENCES user(id),
  checked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_item_cleaning ON checklist_item(cleaning_id, sort_order);

-- ─────────────────────────────────────────────
-- 作業イベントログ（実作業時間の計測・履歴。追記のみ・不変）
--   kind: start | complete | reopen | note | check | uncheck | photo_add | photo_delete
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cleaning_event (
  id          INTEGER PRIMARY KEY,
  cleaning_id INTEGER NOT NULL REFERENCES cleaning(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  user_id     INTEGER REFERENCES user(id),
  at          TEXT    NOT NULL,           -- ISO8601 UTC
  detail      TEXT                        -- 任意（項目ラベル等）
);
CREATE INDEX IF NOT EXISTS idx_cleanevt ON cleaning_event(cleaning_id, at);

-- ─────────────────────────────────────────────
-- 写真（メタデータ）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo (
  id                INTEGER PRIMARY KEY,
  property_id       INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  cleaning_id       INTEGER NOT NULL REFERENCES cleaning(id) ON DELETE CASCADE,
  checklist_item_id INTEGER REFERENCES checklist_item(id) ON DELETE SET NULL,
  storage           TEXT    NOT NULL DEFAULT 'd1' CHECK (storage IN ('d1','r2')),
  r2_key            TEXT,
  r2_thumb_key      TEXT,
  content_type      TEXT    NOT NULL DEFAULT 'image/jpeg',
  size_bytes        INTEGER,
  caption           TEXT,
  uploaded_by       INTEGER NOT NULL REFERENCES user(id),
  uploaded_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photo_cleaning ON photo(cleaning_id);
CREATE INDEX IF NOT EXISTS idx_photo_storage ON photo(storage);

-- 写真バイナリ（MVP: D1 保存。R2 移行後に廃止予定。02 §7.4）
CREATE TABLE IF NOT EXISTS photo_blob (
  photo_id INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
  kind     TEXT    NOT NULL CHECK (kind IN ('full','thumb')),
  bytes    BLOB    NOT NULL,
  PRIMARY KEY (photo_id, kind)
);

-- ─────────────────────────────────────────────
-- 同期ログ
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
  id                INTEGER PRIMARY KEY,
  property_id       INTEGER REFERENCES property(id) ON DELETE CASCADE,
  run_at            TEXT    NOT NULL,
  result            TEXT    NOT NULL CHECK (result IN ('ok','error')),
  reservations_seen INTEGER NOT NULL DEFAULT 0,
  cleanings_created INTEGER NOT NULL DEFAULT 0,
  cleanings_updated INTEGER NOT NULL DEFAULT 0,
  message           TEXT
);
CREATE INDEX IF NOT EXISTS idx_synclog_prop_time ON sync_log(property_id, run_at DESC);

-- ─────────────────────────────────────────────
-- 設定 / メタ（Key-Value）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ─────────────────────────────────────────────
-- 初期データ
-- ─────────────────────────────────────────────
INSERT OR IGNORE INTO app_meta (key, value) VALUES
  ('registration_open', '1'),
  ('max_users', '4'),
  ('schema_version', '1');

-- ベーステンプレの雛形（id=1 固定。実項目は運用開始後に admin が UI で追加）
INSERT OR IGNORE INTO checklist_template (id, name, is_base, property_id, created_at, updated_at)
VALUES (1, '標準ベース', 1, NULL,
        strftime('%Y-%m-%dT%H:%M:%SZ','now'),
        strftime('%Y-%m-%dT%H:%M:%SZ','now'));
