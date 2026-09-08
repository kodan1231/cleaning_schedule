// 履歴（S-04）: 過去の清掃一覧・所要時間・写真・メモ、CSV/JSON エクスポート。
// 参照: docs/02 §2.1(S-04) / docs/01 FR-28〜30

import { Hono } from "hono";
import { all } from "./db/queries.js";
import { requireAuth } from "./auth.js";
import { todayJst, addDays, daysBetween } from "./lib/datetime.js";
import { workDurationMs } from "./lib/events.js";
import { historyPage } from "./views/history.js";

export const history = new Hono();
history.use("*", requireAuth());

function filters(c) {
  const q = c.req.query.bind(c.req);
  const propRaw = q("property") || "";
  const propId = /^\d+$/.test(propRaw) ? parseInt(propRaw, 10) : null;
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  const from = isDate(q("from")) ? q("from") : addDays(todayJst(), -90);
  const to = isDate(q("to")) ? q("to") : todayJst();
  return { propId, from, to, propRaw };
}

async function loadRows(db, { propId, from, to }) {
  const where = ["c.status IN ('done','cancelled')", "c.clean_date >= ?", "c.clean_date <= ?"];
  const args = [from, to];
  if (propId) {
    where.push("c.property_id = ?");
    args.push(propId);
  }
  const rows = await all(
    db,
    `SELECT c.id, c.clean_date, c.status, c.source, c.started_at, c.completed_at,
            p.name AS property_name, cu.name AS completed_by_name, c.note,
            r.checkin_date AS checkin_date,
            (SELECT COUNT(*) FROM photo ph WHERE ph.cleaning_id = c.id) AS photo_count
     FROM cleaning c
     JOIN property p ON p.id = c.property_id
     LEFT JOIN reservation r ON r.id = c.reservation_id
     LEFT JOIN user cu ON cu.id = c.completed_by
     WHERE ${where.join(" AND ")}
     ORDER BY c.clean_date DESC, c.id DESC
     LIMIT 500`,
    ...args,
  );
  if (rows.length === 0) return rows;

  // 実作業時間（イベント区間の合計）をまとめて計算
  const ids = rows.map((r) => r.id);
  const events = await all(
    db,
    `SELECT cleaning_id, kind, at FROM cleaning_event
     WHERE cleaning_id IN (${ids.map(() => "?").join(",")})
     ORDER BY cleaning_id, at, id`,
    ...ids,
  );
  const byCleaning = new Map();
  for (const e of events) {
    if (!byCleaning.has(e.cleaning_id)) byCleaning.set(e.cleaning_id, []);
    byCleaning.get(e.cleaning_id).push(e);
  }
  for (const r of rows) {
    const evs = byCleaning.get(r.id);
    r.duration_ms = evs && evs.length ? workDurationMs(evs) : durationFromCols(r);
  }
  return rows;
}

function durationFromCols(r) {
  if (!r.started_at || !r.completed_at) return 0;
  return Math.max(0, Date.parse(r.completed_at) - Date.parse(r.started_at));
}

async function loadProperties(db) {
  return all(db, "SELECT id, name FROM property ORDER BY name, id");
}

history.get("/", async (c) => {
  const f = filters(c);
  const rows = await loadRows(c.env.DB, f);
  const properties = await loadProperties(c.env.DB);
  return historyPage(c, { rows, properties, filter: f });
});

history.get("/export.json", async (c) => {
  const f = filters(c);
  const rows = await loadRows(c.env.DB, f);
  const data = rows.map((r) => ({
    id: r.id,
    property: r.property_name,
    clean_date: r.clean_date,
    status: r.status,
    source: r.source,
    checkin_date: r.checkin_date || "",
    nights: r.checkin_date ? daysBetween(r.checkin_date, r.clean_date) : "",
    started_at: r.started_at,
    completed_at: r.completed_at,
    duration_minutes: Math.round((r.duration_ms || 0) / 60000),
    completed_by: r.completed_by_name,
    photo_count: r.photo_count,
    note: r.note || "",
  }));
  return c.json(data, 200, {
    "Content-Disposition": `attachment; filename="cleaning-history_${f.from}_${f.to}.json"`,
  });
});

history.get("/export.csv", async (c) => {
  const f = filters(c);
  const rows = await loadRows(c.env.DB, f);
  const head = [
    "物件",
    "清掃日",
    "状態",
    "種別",
    "泊数",
    "チェックイン",
    "開始",
    "完了",
    "実作業分",
    "担当",
    "写真枚数",
    "メモ",
  ];
  const lines = [head];
  for (const r of rows) {
    lines.push([
      r.property_name,
      r.clean_date,
      r.status === "done" ? "完了" : "キャンセル",
      r.source === "manual" ? "臨時" : "iCal",
      r.checkin_date ? String(daysBetween(r.checkin_date, r.clean_date)) : "",
      r.checkin_date || "",
      r.started_at || "",
      r.completed_at || "",
      String(Math.round((r.duration_ms || 0) / 60000)),
      r.completed_by_name || "",
      String(r.photo_count),
      (r.note || "").replace(/\r?\n/g, " "),
    ]);
  }
  const csv = "﻿" + lines.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="cleaning-history_${f.from}_${f.to}.csv"`,
  });
});

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
