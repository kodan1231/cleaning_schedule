// 不足備品（購入依頼メモ）。清掃員が登録し、管理者が購入後に対応済みにする。
// 登録は清掃詳細から（POST /cleanings/:id/shortages・src/cleanings.js）。
// ここは一覧と対応操作。対応済み・未対応に戻す・削除は admin のみ。
// 参照: docs/02_基本設計書.md §4.5 / マイグレーション 0013

import { Hono } from "hono";
import { one, all, run } from "./db/queries.js";
import { requireAuth, verifyCsrf } from "./auth.js";
import { nowIso } from "./lib/datetime.js";
import { shortagesPage } from "./views/shortages.js";

export const shortages = new Hono();
shortages.use("*", requireAuth());

async function form(c) {
  const body = await c.req.parseBody();
  return verifyCsrf(c, body) ? body : null;
}
const badReq = (c) => c.text("Bad Request", 400);
const to = (path, msg) => path + (msg ? `?msg=${encodeURIComponent(msg)}` : "");
const isAdmin = (c) => c.get("user").role === "admin";

async function resolveProperty(c, properties) {
  const raw = c.req.query("property") || "";
  const id = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  if (id && properties.some((p) => p.id === id)) return id;
  return properties[0]?.id ?? null;
}

// ─────────────────────────────────────────────
// GET /shortages  一覧（物件で絞り込み。未対応→対応済みの順）
// ─────────────────────────────────────────────
shortages.get("/", async (c) => {
  const db = c.env.DB;
  const properties = await all(db, "SELECT id, name FROM property WHERE active = 1 ORDER BY name, id");
  const propertyId = await resolveProperty(c, properties);
  const items = propertyId
    ? await all(
        db,
        `SELECT s.id, s.body, s.status, s.created_at, s.done_at, s.cleaning_id,
                cu.name AS created_by_name, du.name AS done_by_name
           FROM shortage s
           JOIN user cu ON cu.id = s.created_by
           LEFT JOIN user du ON du.id = s.done_by
          WHERE s.property_id = ?
          ORDER BY (s.status = 'done'), s.created_at DESC, s.id DESC`,
        propertyId,
      )
    : [];
  return shortagesPage(c, {
    properties,
    selectedPropertyId: propertyId,
    items,
    isAdmin: isAdmin(c),
    msg: c.req.query("msg"),
  });
});

// ─────────────────────────────────────────────
// POST /shortages/:id/done | reopen（admin のみ）
// ─────────────────────────────────────────────
async function setStatus(c, status, okMsg) {
  if (!isAdmin(c)) return c.text("Forbidden", 403);
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const s = await one(c.env.DB, "SELECT id, property_id FROM shortage WHERE id = ?", id);
  if (!s) return c.notFound();
  if (status === "done") {
    await run(
      c.env.DB,
      "UPDATE shortage SET status = 'done', done_by = ?, done_at = ? WHERE id = ?",
      c.get("user").id,
      nowIso(),
      id,
    );
  } else {
    await run(
      c.env.DB,
      "UPDATE shortage SET status = 'open', done_by = NULL, done_at = NULL WHERE id = ?",
      id,
    );
  }
  return c.redirect(to(`/shortages?property=${s.property_id}`, okMsg));
}

shortages.post("/:id/done", (c) => setStatus(c, "done", "対応済みにしました"));
shortages.post("/:id/reopen", (c) => setStatus(c, "open", "未対応に戻しました"));

// ─────────────────────────────────────────────
// POST /shortages/:id/delete（admin のみ）
// ─────────────────────────────────────────────
shortages.post("/:id/delete", async (c) => {
  if (!isAdmin(c)) return c.text("Forbidden", 403);
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const s = await one(c.env.DB, "SELECT id, property_id FROM shortage WHERE id = ?", id);
  if (!s) return c.notFound();
  await run(c.env.DB, "DELETE FROM shortage WHERE id = ?", id);
  return c.redirect(to(`/shortages?property=${s.property_id}`, "削除しました"));
});
