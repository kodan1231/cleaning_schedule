// iCal 同期。P3 で本実装。P0 では Cron が呼んでも安全な no-op。

import { all, run } from "../db/queries.js";
import { nowIso } from "../lib/datetime.js";

/**
 * 全 active 物件を同期する（Cron / 手動同期の共通入口）。
 * P3 で reservation upsert・cleaning 生成を実装する。
 */
export async function runScheduledSync(env) {
  const db = env.DB;
  let properties = [];
  try {
    properties = await all(db, "SELECT id, name FROM property WHERE active = 1");
  } catch (e) {
    console.error("sync: property 取得失敗", e);
    return;
  }
  for (const p of properties) {
    try {
      await syncProperty(env, p.id);
    } catch (e) {
      console.error(`sync: 物件 ${p.id} 失敗`, e);
      await safeLog(db, p.id, "error", 0, 0, 0, String(e?.message || e));
    }
  }
}

/** 単一物件の同期（P3 で実装） */
export async function syncProperty(env, propertyId) {
  // TODO(P3): iCal 取得 → パース → reservation upsert → cleaning 生成/更新
  await safeLog(env.DB, propertyId, "ok", 0, 0, 0, "P0 stub: 未実装");
}

async function safeLog(db, propertyId, result, seen, created, updated, message) {
  try {
    await run(
      db,
      `INSERT INTO sync_log
         (property_id, run_at, result, reservations_seen, cleanings_created, cleanings_updated, message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      propertyId,
      nowIso(),
      result,
      seen,
      created,
      updated,
      message,
    );
  } catch (e) {
    console.error("sync_log 書き込み失敗", e);
  }
}
