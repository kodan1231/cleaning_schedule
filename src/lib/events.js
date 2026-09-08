// 作業イベントログ。実作業時間の計測・履歴表示に使う。
// テーブル: cleaning_event（追記のみ）。

import { run } from "../db/queries.js";
import { nowIso } from "./datetime.js";

/** イベントを1件記録する（失敗しても本処理は止めない） */
export async function logEvent(db, cleaningId, kind, userId, detail = null) {
  try {
    await run(
      db,
      "INSERT INTO cleaning_event (cleaning_id, kind, user_id, at, detail) VALUES (?, ?, ?, ?, ?)",
      cleaningId,
      kind,
      userId ?? null,
      nowIso(),
      detail,
    );
  } catch (e) {
    console.error("cleaning_event 記録失敗", e);
  }
}

/**
 * 実作業時間（ミリ秒）。start / reopen で計測開始、complete で区切る。
 * まだ作業中なら now までを加算。
 */
export function workDurationMs(events, now = Date.now()) {
  let ms = 0;
  let since = null;
  for (const e of events) {
    if (e.kind === "start" || e.kind === "reopen") {
      since = Date.parse(e.at);
    } else if (e.kind === "complete" && since != null) {
      ms += Date.parse(e.at) - since;
      since = null;
    }
  }
  if (since != null) ms += now - since;
  return Math.max(0, ms);
}

/** ミリ秒を "1時間23分" / "45分" / "0分" に */
export function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
}
