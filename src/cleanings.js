// 清掃の一覧（ダッシュボード）・詳細・状態遷移・臨時清掃。
// 参照: docs/02 §2.1(S-02/S-03/S-12) §4.2 / docs/01 FR-11〜FR-21

import { Hono } from "hono";
import { one, all, run } from "./db/queries.js";
import { requireAuth, verifyCsrf } from "./auth.js";
import {
  nowIso,
  todayJst,
  addDays,
  shiftMonth,
  lastDayOfMonth,
  monthGrid,
} from "./lib/datetime.js";
import { snapshotChecklist } from "./lib/checklist.js";
import { logEvent } from "./lib/events.js";
import { dashboardPage, cleaningDetailPage, newCleaningPage } from "./views/cleanings.js";

async function form(c) {
  const body = await c.req.parseBody();
  return verifyCsrf(c, body) ? body : null;
}
const badReq = (c) => c.text("Bad Request", 400);
const to = (path, msg) => path + (msg ? `?msg=${encodeURIComponent(msg)}` : "");

const CARD_COLS = `
  c.id, c.clean_date, c.status, c.source, c.started_at, c.completed_at,
  p.name AS property_name,
  su.name AS started_by_name, cu.name AS completed_by_name,
  (SELECT COUNT(*) FROM checklist_item i WHERE i.cleaning_id = c.id) AS total,
  (SELECT COUNT(*) FROM checklist_item i WHERE i.cleaning_id = c.id AND i.checked = 1) AS done
`;
const CARD_JOINS = `
  FROM cleaning c
  JOIN property p ON p.id = c.property_id
  LEFT JOIN user su ON su.id = c.started_by
  LEFT JOIN user cu ON cu.id = c.completed_by
`;

// ─────────────────────────────────────────────
// GET /  ダッシュボード（月カレンダー）
// ─────────────────────────────────────────────
export async function dashboard(c) {
  const db = c.env.DB;
  const today = todayJst();

  const propRaw = c.req.query("property") || "";
  const propId = /^\d+$/.test(propRaw) ? parseInt(propRaw, 10) : null;
  const propClause = propId ? " AND c.property_id = ?" : "";
  const propArg = propId ? [propId] : [];

  const mRaw = c.req.query("month") || "";
  const month = /^\d{4}-\d{2}$/.test(mRaw) ? mRaw : today.slice(0, 7);
  const monthStart = `${month}-01`;
  const monthEnd = lastDayOfMonth(month);

  const dRaw = c.req.query("day") || "";
  const selectedDay =
    /^\d{4}-\d{2}-\d{2}$/.test(dRaw) && dRaw.slice(0, 7) === month
      ? dRaw
      : today.slice(0, 7) === month
        ? today
        : monthStart;

  const rows = await all(
    db,
    `SELECT ${CARD_COLS} ${CARD_JOINS}
     WHERE c.status != 'cancelled'
       AND c.clean_date BETWEEN ? AND ?${propClause}
     ORDER BY c.clean_date ASC, p.name ASC`,
    monthStart,
    monthEnd,
    ...propArg,
  );

  const byDate = {};
  for (const r of rows) (byDate[r.clean_date] ||= []).push(r);

  // 期限切れ（未完了・過去日）— 当月以外も含めて件数だけ数える
  const overdue = await one(
    db,
    `SELECT COUNT(*) AS n, MIN(c.clean_date) AS first
       FROM cleaning c
      WHERE c.status IN ('pending','in_progress') AND c.clean_date < ?${propClause}`,
    today,
    ...propArg,
  );

  const properties = await all(
    db,
    "SELECT id, name FROM property WHERE active = 1 ORDER BY name, id",
  );

  return dashboardPage(c, {
    today,
    month,
    prevMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    weeks: monthGrid(month),
    byDate,
    selectedDay,
    dayCleanings: byDate[selectedDay] || [],
    overdue: overdue?.n ? { count: overdue.n, first: overdue.first } : null,
    properties,
    selectedProperty: propId ? String(propId) : "",
    msg: c.req.query("msg"),
  });
}

// ─────────────────────────────────────────────
// /cleanings/*
// ─────────────────────────────────────────────
export const cleanings = new Hono();
cleanings.use("*", requireAuth());

// 臨時清掃（:id より前に登録）
cleanings.get("/new", async (c) => {
  const properties = await all(
    c.env.DB,
    "SELECT id, name FROM property WHERE active = 1 ORDER BY name, id",
  );
  return newCleaningPage(c, { properties });
});

cleanings.post("/new", async (c) => {
  const body = await form(c);
  if (!body) return badReq(c);
  const properties = await all(
    c.env.DB,
    "SELECT id, name FROM property WHERE active = 1 ORDER BY name, id",
  );
  const propertyId = parseInt(String(body.property_id || ""), 10);
  const cleanDate = String(body.clean_date || "").trim();
  const prop = properties.find((p) => p.id === propertyId);
  const errs = [];
  if (!prop) errs.push("物件を選択してください");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) errs.push("清掃日を入力してください");
  if (errs.length) {
    return newCleaningPage(c, {
      properties,
      values: { property_id: propertyId, clean_date: cleanDate },
      err: errs.join(" / "),
    });
  }
  const full = await one(c.env.DB, "SELECT template_id FROM property WHERE id = ?", propertyId);
  const meta = await run(
    c.env.DB,
    `INSERT INTO cleaning (property_id, reservation_id, clean_date, source, status, created_at)
     VALUES (?, NULL, ?, 'manual', 'pending', ?)`,
    propertyId,
    cleanDate,
    nowIso(),
  );
  await snapshotChecklist(c.env.DB, meta.last_row_id, full?.template_id);
  return c.redirect(to(`/cleanings/${meta.last_row_id}`, "臨時清掃を追加しました"));
});

async function loadCleaning(c, id) {
  return one(
    c.env.DB,
    `SELECT c.*, p.name AS property_name, p.checkout_time,
            r.guest_hint AS guest_hint,
            su.name AS started_by_name, cu.name AS completed_by_name
     FROM cleaning c
     JOIN property p ON p.id = c.property_id
     LEFT JOIN reservation r ON r.id = c.reservation_id
     LEFT JOIN user su ON su.id = c.started_by
     LEFT JOIN user cu ON cu.id = c.completed_by
     WHERE c.id = ?`,
    id,
  );
}

cleanings.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const cleaning = await loadCleaning(c, id);
  if (!cleaning) return c.notFound();
  const items = await all(
    c.env.DB,
    `SELECT i.*, u.name AS checked_by_name
     FROM checklist_item i
     LEFT JOIN user u ON u.id = i.checked_by
     WHERE i.cleaning_id = ? ORDER BY i.area_label, i.sort_order, i.id`,
    id,
  );
  const events = await all(
    c.env.DB,
    `SELECT e.kind, e.at, e.detail, u.name AS user_name
     FROM cleaning_event e LEFT JOIN user u ON u.id = e.user_id
     WHERE e.cleaning_id = ? ORDER BY e.at ASC, e.id ASC`,
    id,
  );
  return cleaningDetailPage(c, { cleaning, items, events, msg: c.req.query("msg") });
});

// ── 状態遷移 ──
async function transition(c, { from: fromStatus, set, kind, okMsg, busyMsg }) {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const cl = await one(c.env.DB, "SELECT id, status FROM cleaning WHERE id = ?", id);
  if (!cl) return c.notFound();
  if (cl.status !== fromStatus) {
    return c.redirect(to(`/cleanings/${id}`, busyMsg));
  }
  await run(c.env.DB, `UPDATE cleaning SET ${set.sql} WHERE id = ?`, ...set.args(c), id);
  await logEvent(c.env.DB, id, kind, c.get("user").id);
  return c.redirect(to(`/cleanings/${id}`, okMsg));
}

cleanings.post("/:id/start", (c) =>
  transition(c, {
    from: "pending",
    kind: "start",
    set: {
      sql: "status = 'in_progress', started_by = ?, started_at = ?",
      args: (ctx) => [ctx.get("user").id, nowIso()],
    },
    okMsg: "清掃を開始しました",
    busyMsg: "この清掃は開始できません",
  }),
);

cleanings.post("/:id/complete", (c) =>
  transition(c, {
    from: "in_progress",
    kind: "complete",
    set: {
      sql: "status = 'done', completed_by = ?, completed_at = ?",
      args: (ctx) => [ctx.get("user").id, nowIso()],
    },
    okMsg: "清掃を完了しました",
    busyMsg: "この清掃は完了できません",
  }),
);

cleanings.post("/:id/reopen", (c) =>
  transition(c, {
    from: "done",
    kind: "reopen",
    set: {
      sql: "status = 'in_progress', completed_by = NULL, completed_at = NULL",
      args: () => [],
    },
    okMsg: "作業中に戻しました",
    busyMsg: "この清掃は再オープンできません",
  }),
);

cleanings.post("/:id/note", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const cl = await one(c.env.DB, "SELECT id FROM cleaning WHERE id = ?", id);
  if (!cl) return c.notFound();
  const note = String(body.note || "").trim().slice(0, 2000);
  await run(c.env.DB, "UPDATE cleaning SET note = ? WHERE id = ?", note || null, id);
  await logEvent(c.env.DB, id, "note", c.get("user").id);
  return c.redirect(to(`/cleanings/${id}`, "メモを保存しました"));
});

// ── 清掃の削除（admin のみ。iCal 由来は次回同期で再作成される）──
cleanings.post("/:id/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  if (c.get("user").role !== "admin") return c.text("Forbidden", 403);
  const cl = await one(c.env.DB, "SELECT id FROM cleaning WHERE id = ?", id);
  if (!cl) return c.notFound();
  await run(c.env.DB, "DELETE FROM checklist_item WHERE cleaning_id = ?", id);
  await run(c.env.DB, "DELETE FROM photo_blob WHERE photo_id IN (SELECT id FROM photo WHERE cleaning_id = ?)", id);
  await run(c.env.DB, "DELETE FROM photo WHERE cleaning_id = ?", id);
  await run(c.env.DB, "DELETE FROM cleaning_event WHERE cleaning_id = ?", id);
  await run(c.env.DB, "DELETE FROM cleaning WHERE id = ?", id);
  return c.redirect(to("/", "清掃を削除しました"));
});

// ── チェック項目のトグル（FR-16）──
cleanings.post("/:id/items/:iid/toggle", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const iid = parseInt(c.req.param("iid"), 10);
  const body = await form(c);
  const wantsJson = (c.req.header("accept") || "").includes("application/json");
  if (!body) return wantsJson ? c.json({ ok: false, error: "bad_request" }, 400) : badReq(c);

  const cl = await one(c.env.DB, "SELECT id, status FROM cleaning WHERE id = ?", id);
  if (!cl) return c.notFound();
  const item = await one(
    c.env.DB,
    "SELECT id, checked, label FROM checklist_item WHERE id = ? AND cleaning_id = ?",
    iid,
    id,
  );
  if (!item) return c.notFound();

  if (cl.status === "cancelled") {
    return wantsJson
      ? c.json({ ok: false, error: "cancelled" }, 409)
      : c.redirect(to(`/cleanings/${id}`, "キャンセル済みの清掃は編集できません"));
  }

  const now = item.checked ? 0 : 1;
  const uid = c.get("user").id;
  await run(
    c.env.DB,
    "UPDATE checklist_item SET checked = ?, checked_by = ?, checked_at = ? WHERE id = ?",
    now,
    now ? uid : null,
    now ? nowIso() : null,
    iid,
  );
  await logEvent(c.env.DB, id, now ? "check" : "uncheck", uid, item.label);

  if (!wantsJson) return c.redirect(`/cleanings/${id}`);

  const items = await all(
    c.env.DB,
    "SELECT area_label, checked FROM checklist_item WHERE cleaning_id = ?",
    id,
  );
  const row = await one(c.env.DB, "SELECT area_label FROM checklist_item WHERE id = ?", iid);
  const area = row?.area_label;
  const areaItems = items.filter((x) => x.area_label === area);
  return c.json({
    ok: true,
    checked: now,
    checkedBy: now ? c.get("user").name : null,
    overall: { done: items.filter((x) => x.checked).length, total: items.length },
    area: {
      label: area,
      done: areaItems.filter((x) => x.checked).length,
      total: areaItems.length,
    },
  });
});
