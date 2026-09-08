// iCal 同期: 取得 → 予約/ブロック分類 → reservation upsert → 消滅検知
//            → cleaning 生成/更新（+ checklist_item スナップショット）→ sync_log
// 参照: docs/02_基本設計書.md §5, §3.2 / docs/01 FR-1〜FR-10

import { all, one, run } from "../db/queries.js";
import { nowIso, todayJst, addDays } from "../lib/datetime.js";
import { snapshotChecklist } from "../lib/checklist.js";
import { parseEvents, classifyEvent } from "./parser.js";

const UA = "cleaning-schedule/1.0 (+https://cleaning-schedule.kodan1231.workers.dev)";
const FETCH_TIMEOUT_MS = 20000;
const FETCH_TRIES = 3;
const PAST_DAYS = 3;
const FUTURE_DAYS = 180;

/** 全 active 物件を同期する（Cron / 手動「全物件同期」の共通入口） */
export async function runScheduledSync(env) {
  let properties = [];
  try {
    properties = await all(env.DB, "SELECT id FROM property WHERE active = 1");
  } catch (e) {
    console.error("sync: property 取得失敗", e);
    return [];
  }
  const results = [];
  for (const p of properties) {
    try {
      results.push(await syncProperty(env, p.id));
    } catch (e) {
      console.error(`sync: 物件 ${p.id} 失敗`, e?.stack || e);
      await writeLog(env.DB, p.id, "error", 0, 0, 0, truncate(String(e?.message || e)));
      results.push({ propertyId: p.id, result: "error", message: String(e?.message || e) });
    }
  }
  return results;
}

/** 単一物件を同期する */
export async function syncProperty(env, propertyId) {
  const db = env.DB;
  const prop = await one(
    db,
    "SELECT id, name, ical_url FROM property WHERE id = ?",
    propertyId,
  );
  if (!prop) throw new Error("物件が見つかりません");

  let text;
  try {
    text = await fetchIcal(prop.ical_url);
  } catch (e) {
    const msg = `取得失敗: ${truncate(String(e?.message || e))}`;
    await writeLog(db, propertyId, "error", 0, 0, 0, msg);
    return { propertyId, result: "error", message: msg };
  }

  // パース + 予約抽出
  const reservations = [];
  for (const ev of parseEvents(text)) {
    const c = classifyEvent(ev);
    if (c.kind === "reservation" && c.uid && c.checkin_date && c.checkout_date) {
      reservations.push(c);
    }
  }

  const today = todayJst();
  const minDate = addDays(today, -PAST_DAYS);
  const maxDate = addDays(today, FUTURE_DAYS);
  const inWindow = (d) => d >= minDate && d <= maxDate;

  let created = 0;
  let updated = 0;
  let cancelled = 0;
  const seen = new Set();

  for (const r of reservations) {
    seen.add(r.uid);
    const ex = await one(
      db,
      "SELECT id, checkout_date FROM reservation WHERE property_id = ? AND ical_uid = ?",
      propertyId,
      r.uid,
    );

    let reservationId;
    if (!ex) {
      const meta = await run(
        db,
        `INSERT INTO reservation
           (property_id, ical_uid, checkin_date, checkout_date, guest_hint, status, raw_text, synced_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
        propertyId,
        r.uid,
        r.checkin_date,
        r.checkout_date,
        r.guest_hint,
        r.raw,
        nowIso(),
      );
      reservationId = meta.last_row_id;
    } else {
      reservationId = ex.id;
      await run(
        db,
        `UPDATE reservation
           SET checkin_date = ?, checkout_date = ?, guest_hint = ?,
               status = 'active', raw_text = ?, synced_at = ?
         WHERE id = ?`,
        r.checkin_date,
        r.checkout_date,
        r.guest_hint,
        r.raw,
        nowIso(),
        ex.id,
      );
      if (ex.checkout_date !== r.checkout_date) {
        updated += await moveCleaning(db, ex.id, r.checkout_date);
      }
    }

    if (inWindow(r.checkout_date)) {
      if (await ensureCleaning(db, prop, reservationId, r.checkout_date)) created++;
    }
  }

  // 消滅検知: iCal に現れなかった active 予約をキャンセル
  const actives = await all(
    db,
    "SELECT id, ical_uid FROM reservation WHERE property_id = ? AND status = 'active'",
    propertyId,
  );
  for (const a of actives) {
    if (!seen.has(a.ical_uid)) {
      await run(
        db,
        "UPDATE reservation SET status = 'cancelled', synced_at = ? WHERE id = ?",
        nowIso(),
        a.id,
      );
      cancelled += await cancelCleaning(db, a.id);
    }
  }

  const note =
    [
      cancelled ? `${cancelled}件キャンセル` : null,
      updated ? `${updated}件日程変更` : null,
    ]
      .filter(Boolean)
      .join(" / ") || null;
  await writeLog(db, propertyId, "ok", reservations.length, created, updated + cancelled, note);
  return { propertyId, result: "ok", seen: reservations.length, created, updated, cancelled };
}

// ───────────────────────── 取得 ─────────────────────────
async function fetchIcal(url) {
  let lastErr;
  for (let i = 0; i < FETCH_TRIES; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/calendar, text/plain, */*" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cf: { cacheTtl: 0 },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes("BEGIN:VCALENDAR")) throw new Error("iCalendar 形式ではありません");
      return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("取得に失敗しました");
}

// ───────────────────────── cleaning ─────────────────────────
/** 予約に対応する清掃が無ければ生成し、テンプレを展開する。生成したら true */
async function ensureCleaning(db, prop, reservationId, checkoutDate) {
  const ex = await one(
    db,
    "SELECT id FROM cleaning WHERE property_id = ? AND clean_date = ? AND reservation_id = ?",
    prop.id,
    checkoutDate,
    reservationId,
  );
  if (ex) return false;
  const meta = await run(
    db,
    `INSERT INTO cleaning (property_id, reservation_id, clean_date, source, status, created_at)
     VALUES (?, ?, ?, 'ical', 'pending', ?)`,
    prop.id,
    reservationId,
    checkoutDate,
    nowIso(),
  );
  await snapshotChecklist(db, meta.last_row_id, prop.id);
  return true;
}

/** 日程変更: 未完了(pending/in_progress)の清掃だけ clean_date を更新。動かした件数を返す */
async function moveCleaning(db, reservationId, newDate) {
  const rows = await all(
    db,
    "SELECT id, status, clean_date FROM cleaning WHERE reservation_id = ?",
    reservationId,
  );
  let moved = 0;
  for (const c of rows) {
    if ((c.status === "pending" || c.status === "in_progress") && c.clean_date !== newDate) {
      const clash = await one(
        db,
        "SELECT id FROM cleaning WHERE reservation_id = ? AND clean_date = ? AND id <> ?",
        reservationId,
        newDate,
        c.id,
      );
      if (!clash) {
        await run(db, "UPDATE cleaning SET clean_date = ? WHERE id = ?", newDate, c.id);
        moved++;
      }
    }
  }
  return moved;
}

/** 予約消滅: 未着手の清掃をキャンセル。作業中/完了は維持。キャンセル件数を返す */
async function cancelCleaning(db, reservationId) {
  const rows = await all(
    db,
    "SELECT id, status FROM cleaning WHERE reservation_id = ?",
    reservationId,
  );
  let n = 0;
  for (const c of rows) {
    if (c.status === "pending") {
      await run(db, "UPDATE cleaning SET status = 'cancelled' WHERE id = ?", c.id);
      n++;
    }
  }
  return n;
}

// ───────────────────────── sync_log ─────────────────────────
async function writeLog(db, propertyId, result, seen, createdN, updatedN, message) {
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
      createdN,
      updatedN,
      message,
    );
  } catch (e) {
    console.error("sync_log 書き込み失敗", e);
  }
}

function truncate(s, n = 300) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}
