// 備品（消耗品）の在庫管理。物件ごとに一覧・在庫数の更新ができる。
// マスタ（名前・単位）の追加・編集・削除・並べ替えは admin のみ。在庫数の更新は全メンバー可。
// 参照: docs/02_基本設計書.md §2 / マイグレーション 0012

import { Hono } from "hono";
import { one, all, run } from "./db/queries.js";
import { requireAuth, verifyCsrf } from "./auth.js";
import { nowIso } from "./lib/datetime.js";
import { suppliesPage } from "./views/supplies.js";

export const supplies = new Hono();
supplies.use("*", requireAuth());

async function form(c) {
  const body = await c.req.parseBody();
  return verifyCsrf(c, body) ? body : null;
}
const badReq = (c) => c.text("Bad Request", 400);
const to = (path, msg) => path + (msg ? `?msg=${encodeURIComponent(msg)}` : "");
const isAdmin = (c) => c.get("user").role === "admin";

async function loadProperties(db) {
  return all(db, "SELECT id, name FROM property WHERE active = 1 ORDER BY name, id");
}

async function resolveProperty(c, properties) {
  const raw = c.req.query("property") || "";
  const id = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  if (id && properties.some((p) => p.id === id)) return id;
  return properties[0]?.id ?? null;
}

// ─────────────────────────────────────────────
// GET /supplies  一覧（物件で絞り込み）
// ─────────────────────────────────────────────
supplies.get("/", async (c) => {
  const db = c.env.DB;
  const properties = await loadProperties(db);
  const propertyId = await resolveProperty(c, properties);
  const items = propertyId
    ? await all(
        db,
        `SELECT s.id, s.name, s.unit, s.stock, s.note, s.updated_at, u.name AS updated_by_name
         FROM supply s LEFT JOIN user u ON u.id = s.updated_by
         WHERE s.property_id = ? ORDER BY s.sort_order, s.id`,
        propertyId,
      )
    : [];
  return suppliesPage(c, {
    properties,
    selectedPropertyId: propertyId,
    items,
    isAdmin: isAdmin(c),
    msg: c.req.query("msg"),
  });
});

// ─────────────────────────────────────────────
// POST /supplies/:id/stock  在庫数の更新（全メンバー）
// ─────────────────────────────────────────────
supplies.post("/:id/stock", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const s = await one(c.env.DB, "SELECT id, property_id FROM supply WHERE id = ?", id);
  if (!s) return c.notFound();

  const stock = parseInt(String(body.stock ?? ""), 10);
  if (!Number.isInteger(stock) || stock < 0) {
    return c.redirect(to(`/supplies?property=${s.property_id}`, "在庫数は0以上の整数で入力してください"));
  }
  const note = String(body.note || "").trim().slice(0, 200) || null;
  const uid = c.get("user").id;
  const at = nowIso();

  await run(
    c.env.DB,
    "UPDATE supply SET stock = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?",
    stock,
    note,
    uid,
    at,
    id,
  );
  await run(
    c.env.DB,
    "INSERT INTO supply_log (supply_id, stock, note, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)",
    id,
    stock,
    note,
    uid,
    at,
  );
  return c.redirect(to(`/supplies?property=${s.property_id}`, "在庫数を更新しました"));
});

// ─────────────────────────────────────────────
// POST /supplies  備品を追加（admin のみ）
// ─────────────────────────────────────────────
supplies.post("/", async (c) => {
  if (!isAdmin(c)) return c.text("Forbidden", 403);
  const body = await form(c);
  if (!body) return badReq(c);
  const propertyId = parseInt(String(body.property_id || ""), 10);
  const prop = await one(c.env.DB, "SELECT id FROM property WHERE id = ?", propertyId);
  if (!prop) return badReq(c);

  const name = String(body.name || "").trim().slice(0, 60);
  if (!name) return c.redirect(to(`/supplies?property=${propertyId}`, "備品名を入力してください"));
  const unit = String(body.unit || "").trim().slice(0, 20) || null;
  const stock = parseInt(String(body.stock ?? "0"), 10) || 0;

  const next =
    (await one(c.env.DB, "SELECT MAX(sort_order) AS m FROM supply WHERE property_id = ?", propertyId))?.m ?? -1;
  const uid = c.get("user").id;
  const at = nowIso();
  const meta = await run(
    c.env.DB,
    `INSERT INTO supply (property_id, name, unit, sort_order, stock, updated_by, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    propertyId,
    name,
    unit,
    next + 1,
    stock,
    uid,
    at,
    at,
  );
  await run(
    c.env.DB,
    "INSERT INTO supply_log (supply_id, stock, note, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)",
    meta.last_row_id,
    stock,
    "登録時の在庫",
    uid,
    at,
  );
  return c.redirect(to(`/supplies?property=${propertyId}`, "備品を追加しました"));
});

// ─────────────────────────────────────────────
// POST /supplies/:id  備品マスタの編集（名前・単位。admin のみ）
// ─────────────────────────────────────────────
supplies.post("/:id", async (c) => {
  if (!isAdmin(c)) return c.text("Forbidden", 403);
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const s = await one(c.env.DB, "SELECT id, property_id FROM supply WHERE id = ?", id);
  if (!s) return c.notFound();

  const name = String(body.name || "").trim().slice(0, 60);
  if (!name) return c.redirect(to(`/supplies?property=${s.property_id}`, "備品名を入力してください"));
  const unit = String(body.unit || "").trim().slice(0, 20) || null;
  await run(c.env.DB, "UPDATE supply SET name = ?, unit = ? WHERE id = ?", name, unit, id);
  return c.redirect(to(`/supplies?property=${s.property_id}`, "備品を更新しました"));
});

// ─────────────────────────────────────────────
// POST /supplies/:id/move  並べ替え（admin のみ）
// ─────────────────────────────────────────────
supplies.post("/:id/move", async (c) => {
  if (!isAdmin(c)) return c.text("Forbidden", 403);
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const s = await one(c.env.DB, "SELECT id, property_id FROM supply WHERE id = ?", id);
  if (!s) return c.notFound();

  const dir = body.dir === "down" ? "down" : "up";
  const rows = await all(
    c.env.DB,
    "SELECT id, sort_order FROM supply WHERE property_id = ? ORDER BY sort_order, id",
    s.property_id,
  );
  const idx = rows.findIndex((r) => r.id === id);
  const j = dir === "up" ? idx - 1 : idx + 1;
  if (idx >= 0 && j >= 0 && j < rows.length) {
    await run(c.env.DB, "UPDATE supply SET sort_order = ? WHERE id = ?", rows[j].sort_order, rows[idx].id);
    await run(c.env.DB, "UPDATE supply SET sort_order = ? WHERE id = ?", rows[idx].sort_order, rows[j].id);
  }
  return c.redirect(`/supplies?property=${s.property_id}`);
});

// ─────────────────────────────────────────────
// POST /supplies/:id/delete（admin のみ）
// ─────────────────────────────────────────────
supplies.post("/:id/delete", async (c) => {
  if (!isAdmin(c)) return c.text("Forbidden", 403);
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const s = await one(c.env.DB, "SELECT id, property_id FROM supply WHERE id = ?", id);
  if (!s) return c.notFound();
  await run(c.env.DB, "DELETE FROM supply WHERE id = ?", id);
  return c.redirect(to(`/supplies?property=${s.property_id}`, "備品を削除しました"));
});
