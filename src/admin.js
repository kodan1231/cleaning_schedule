// 管理画面（admin のみ）: 物件・テンプレート・ユーザー管理。
// 参照: docs/02_基本設計書.md §2, §4.4, §6.1 / docs/05_実装計画.md P2

import { Hono } from "hono";
import { one, all, run, getMeta, setMeta } from "./db/queries.js";
import { requireAuth, requireAdmin, verifyCsrf, hashPin } from "./auth.js";
import { itemKey, randomPin } from "./lib/ids.js";
import { nowIso } from "./lib/datetime.js";
import { resnapshotPending } from "./lib/checklist.js";
import { syncProperty, runScheduledSync } from "./ical/sync.js";
import {
  adminHome,
  propertyList,
  newPropertyPage,
  propertyForm,
  templateList,
  templateEditor,
  userList,
} from "./views/admin.js";

export const admin = new Hono();

admin.use("*", requireAuth(), requireAdmin());

// CSRF 検証済みの body を返す。失敗時は null。
async function form(c) {
  const body = await c.req.parseBody();
  return verifyCsrf(c, body) ? body : null;
}
const badReq = (c) => c.text("Bad Request", 400);

// リダイレクト時のフラッシュ（admin 専用・値はビュー側で HTML エスケープ）
const to = (path, msg) => path + (msg ? `?msg=${encodeURIComponent(msg)}` : "");

// ─────────────────────────────────────────────
// 管理トップ
// ─────────────────────────────────────────────
admin.get("/", async (c) => {
  const db = c.env.DB;
  const counts = await one(
    db,
    `SELECT
       (SELECT COUNT(*) FROM property) AS props,
       (SELECT COUNT(*) FROM checklist_template) AS tpls,
       (SELECT COUNT(*) FROM user) AS users`,
  );
  const properties = await all(
    db,
    `SELECT p.id, p.name, p.active,
       (SELECT COUNT(*) FROM room r WHERE r.property_id = p.id) AS room_count,
       (SELECT s.run_at FROM sync_log s WHERE s.property_id = p.id ORDER BY s.run_at DESC LIMIT 1) AS last_sync,
       (SELECT s.result FROM sync_log s WHERE s.property_id = p.id ORDER BY s.run_at DESC LIMIT 1) AS last_result
     FROM property p
     ORDER BY p.active DESC, p.id`,
  );
  const syncLogs = await all(
    db,
    `SELECT s.run_at, s.result, s.reservations_seen, s.cleanings_created, s.cleanings_updated,
            s.message, p.name AS property
     FROM sync_log s LEFT JOIN property p ON p.id = s.property_id
     ORDER BY s.run_at DESC LIMIT 15`,
  );
  const storage = await one(
    db,
    `SELECT (SELECT COUNT(*) FROM photo) AS photos,
            (SELECT COALESCE(SUM(LENGTH(bytes)), 0) FROM photo_blob) AS bytes`,
  );
  return adminHome(c, { counts, properties, syncLogs, storage, msg: c.req.query("msg") });
});

// ── 同期の手動実行 ──
admin.post("/properties/:id/sync", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const p = await one(c.env.DB, "SELECT id FROM property WHERE id = ?", id);
  if (!p) return c.notFound();
  const r = await syncProperty(c.env, id).catch((e) => ({
    result: "error",
    message: String(e?.message || e),
  }));
  const msg =
    r.result === "ok"
      ? `同期しました（予約 ${r.seen} / 生成 ${r.created} / 更新 ${r.updated} / キャンセル ${r.cancelled} / チェックリスト更新 ${r.refreshed || 0}）`
      : `同期エラー: ${r.message}`;
  return c.redirect(to("/admin", msg));
});

admin.post("/sync-all", async (c) => {
  const body = await form(c);
  if (!body) return badReq(c);
  const results = await runScheduledSync(c.env);
  const ok = results.filter((r) => r.result === "ok").length;
  const ng = results.length - ok;
  return c.redirect(to("/admin", `全物件同期を実行（成功 ${ok} / 失敗 ${ng}）`));
});

// ─────────────────────────────────────────────
// 物件
// ─────────────────────────────────────────────
admin.get("/properties", async (c) => {
  const properties = await all(
    c.env.DB,
    `SELECT p.id, p.name, p.active,
       (SELECT COUNT(*) FROM room r WHERE r.property_id = p.id) AS room_count
     FROM property p ORDER BY p.active DESC, p.id`,
  );
  return propertyList(c, { properties, msg: c.req.query("msg") });
});

admin.get("/properties/new", (c) => newPropertyPage(c));

async function loadTemplates(db) {
  return all(
    db,
    `SELECT t.id, t.name,
       (SELECT COUNT(*) FROM checklist_template_item i WHERE i.template_id = t.id) AS items
     FROM checklist_template t ORDER BY t.name, t.id`,
  );
}

function validateProperty(body) {
  const name = String(body.name || "").trim();
  const ical_url = String(body.ical_url || "").trim();
  const checkout_time = String(body.checkout_time || "").trim();
  const note = String(body.note || "").trim();
  const errs = [];
  if (name.length < 1 || name.length > 60) errs.push("物件名は1〜60文字で入力してください");
  if (!/^https?:\/\//.test(ical_url) || ical_url.length > 500)
    errs.push("iCal URL は http(s) から始まる正しい URL を入力してください");
  if (!/^\d{2}:\d{2}$/.test(checkout_time)) errs.push("チェックアウト時刻を入力してください");
  return { data: { name, ical_url, checkout_time, note }, errs };
}

async function propertyDetailData(c, id, extra = {}) {
  const p = await one(c.env.DB, "SELECT * FROM property WHERE id = ?", id);
  if (!p) return null;
  const rooms = await all(
    c.env.DB,
    `SELECT r.id, r.name, r.sort_order, r.template_id, t.name AS template_name,
            (SELECT COUNT(*) FROM checklist_template_item i WHERE i.template_id = r.template_id) AS item_count
     FROM room r LEFT JOIN checklist_template t ON t.id = r.template_id
     WHERE r.property_id = ? ORDER BY r.sort_order, r.id`,
    id,
  );
  const templates = await loadTemplates(c.env.DB);
  return { p, rooms, templates, msg: c.req.query("msg"), ...extra };
}

admin.post("/properties", async (c) => {
  const body = await form(c);
  if (!body) return badReq(c);
  const { data, errs } = validateProperty(body);
  if (errs.length) return newPropertyPage(c, { err: errs.join(" / ") });
  const meta = await run(
    c.env.DB,
    `INSERT INTO property (name, ical_url, active, checkout_time, note, created_at)
     VALUES (?, ?, 1, ?, ?, ?)`,
    data.name,
    data.ical_url,
    data.checkout_time,
    data.note || null,
    nowIso(),
  );
  return c.redirect(
    to(`/admin/properties/${meta.last_row_id}`, "物件を追加しました。続けて間取りを登録してください"),
  );
});

admin.get("/properties/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const data = await propertyDetailData(c, id);
  if (!data) return c.notFound();
  return propertyForm(c, data);
});

admin.post("/properties/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const p = await one(c.env.DB, "SELECT id FROM property WHERE id = ?", id);
  if (!p) return c.notFound();
  const { data, errs } = validateProperty(body);
  if (errs.length) {
    const d = await propertyDetailData(c, id, { err: errs.join(" / ") });
    return propertyForm(c, { ...d, p: { ...d.p, ...data } });
  }
  await run(
    c.env.DB,
    "UPDATE property SET name = ?, ical_url = ?, checkout_time = ?, note = ? WHERE id = ?",
    data.name,
    data.ical_url,
    data.checkout_time,
    data.note || null,
    id,
  );
  return c.redirect(to(`/admin/properties/${id}`, "保存しました"));
});

// ── チェックリストの再生成（未完了の清掃を現テンプレで作り直す）──
admin.post("/properties/:id/resnapshot", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const p = await one(c.env.DB, "SELECT id FROM property WHERE id = ?", id);
  if (!p) return c.notFound();
  const done = await resnapshotPending(c.env.DB, id, { force: true, includeInProgress: true });
  return c.redirect(
    to(`/admin/properties/${id}`, `${done.length} 件の清掃のチェックリストを再生成しました`),
  );
});

// ── 間取り（部屋）──
admin.post("/properties/:id/rooms", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const p = await one(c.env.DB, "SELECT id FROM property WHERE id = ?", id);
  if (!p) return c.notFound();
  const name = String(body.name || "").trim();
  if (name.length < 1 || name.length > 40) {
    return propertyForm(c, await propertyDetailData(c, id, { err: "間取り名は1〜40文字です" }));
  }
  const templateId = /^\d+$/.test(String(body.template_id)) ? parseInt(body.template_id, 10) : null;
  const next =
    (await one(c.env.DB, "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM room WHERE property_id = ?", id))
      ?.n || 1;
  await run(
    c.env.DB,
    "INSERT INTO room (property_id, name, sort_order, template_id, created_at) VALUES (?, ?, ?, ?, ?)",
    id,
    name,
    next,
    templateId,
    nowIso(),
  );
  return c.redirect(to(`/admin/properties/${id}`, "間取りを追加しました"));
});

admin.post("/properties/:id/rooms/:rid", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const rid = parseInt(c.req.param("rid"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const room = await one(c.env.DB, "SELECT id FROM room WHERE id = ? AND property_id = ?", rid, id);
  if (!room) return c.notFound();
  const name = String(body.name || "").trim();
  if (name.length < 1 || name.length > 40) {
    return propertyForm(c, await propertyDetailData(c, id, { err: "間取り名は1〜40文字です" }));
  }
  const templateId = /^\d+$/.test(String(body.template_id)) ? parseInt(body.template_id, 10) : null;
  await run(
    c.env.DB,
    "UPDATE room SET name = ?, template_id = ? WHERE id = ?",
    name,
    templateId,
    rid,
  );
  return c.redirect(to(`/admin/properties/${id}`, "間取りを保存しました"));
});

admin.post("/properties/:id/rooms/:rid/move", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const rid = parseInt(c.req.param("rid"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const dir = body.dir === "down" ? "down" : "up";
  const rooms = await all(
    c.env.DB,
    "SELECT id, sort_order FROM room WHERE property_id = ? ORDER BY sort_order, id",
    id,
  );
  const idx = rooms.findIndex((r) => r.id === rid);
  const j = dir === "up" ? idx - 1 : idx + 1;
  if (idx >= 0 && j >= 0 && j < rooms.length) {
    await run(c.env.DB, "UPDATE room SET sort_order = ? WHERE id = ?", rooms[j].sort_order, rooms[idx].id);
    await run(c.env.DB, "UPDATE room SET sort_order = ? WHERE id = ?", rooms[idx].sort_order, rooms[j].id);
  }
  return c.redirect(`/admin/properties/${id}`);
});

admin.post("/properties/:id/rooms/:rid/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const rid = parseInt(c.req.param("rid"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  await run(c.env.DB, "DELETE FROM room WHERE id = ? AND property_id = ?", rid, id);
  return c.redirect(to(`/admin/properties/${id}`, "間取りを削除しました"));
});

admin.post("/properties/:id/toggle", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const p = await one(c.env.DB, "SELECT active FROM property WHERE id = ?", id);
  if (!p) return c.notFound();
  await run(c.env.DB, "UPDATE property SET active = ? WHERE id = ?", p.active ? 0 : 1, id);
  return c.redirect(to(`/admin/properties/${id}`, p.active ? "無効にしました" : "有効に戻しました"));
});

// ─────────────────────────────────────────────
// テンプレート
// ─────────────────────────────────────────────
async function loadTemplateList(db) {
  return all(
    db,
    `SELECT t.id, t.name,
       (SELECT COUNT(*) FROM checklist_template_item i WHERE i.template_id = t.id) AS items,
       (SELECT COUNT(*) FROM room r WHERE r.template_id = t.id) AS rooms
     FROM checklist_template t
     ORDER BY t.name, t.id`,
  );
}

admin.get("/templates", async (c) => {
  return templateList(c, { templates: await loadTemplateList(c.env.DB), msg: c.req.query("msg") });
});

admin.post("/templates", async (c) => {
  const body = await form(c);
  if (!body) return badReq(c);
  const name = String(body.name || "").trim();
  if (name.length < 1 || name.length > 60) {
    return templateList(c, {
      templates: await loadTemplateList(c.env.DB),
      err: "名称は1〜60文字で入力してください",
    });
  }
  const now = nowIso();
  const meta = await run(
    c.env.DB,
    "INSERT INTO checklist_template (name, is_base, property_id, created_at, updated_at) VALUES (?, 0, NULL, ?, ?)",
    name,
    now,
    now,
  );
  return c.redirect(to(`/admin/templates/${meta.last_row_id}`, "テンプレートを作成しました"));
});

async function renderEditor(c, id, extra = {}) {
  const t = await one(c.env.DB, "SELECT * FROM checklist_template WHERE id = ?", id);
  if (!t) return c.notFound();
  const items = await all(
    c.env.DB,
    "SELECT * FROM checklist_template_item WHERE template_id = ? ORDER BY sort_order, id",
    id,
  );
  const roomCount =
    (await one(c.env.DB, "SELECT COUNT(*) AS c FROM room WHERE template_id = ?", id))?.c || 0;
  return templateEditor(c, { t, items, roomCount, msg: c.req.query("msg"), ...extra });
}

admin.get("/templates/:id", (c) => renderEditor(c, parseInt(c.req.param("id"), 10)));

admin.post("/templates/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const name = String(body.name || "").trim();
  if (name.length < 1 || name.length > 60) return renderEditor(c, id, { err: "名称は1〜60文字です" });
  await run(
    c.env.DB,
    "UPDATE checklist_template SET name = ?, updated_at = ? WHERE id = ?",
    name,
    nowIso(),
    id,
  );
  return c.redirect(to(`/admin/templates/${id}`, "名称を保存しました"));
});

admin.post("/templates/:id/clone", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const t = await one(c.env.DB, "SELECT * FROM checklist_template WHERE id = ?", id);
  if (!t) return c.notFound();
  const now = nowIso();
  const meta = await run(
    c.env.DB,
    "INSERT INTO checklist_template (name, is_base, property_id, created_at, updated_at) VALUES (?, 0, NULL, ?, ?)",
    `${t.name} のコピー`,
    now,
    now,
  );
  const newId = meta.last_row_id;
  const items = await all(
    c.env.DB,
    "SELECT sort_order, label, needs_photo, note FROM checklist_template_item WHERE template_id = ?",
    id,
  );
  for (const it of items) {
    await run(
      c.env.DB,
      `INSERT INTO checklist_template_item (template_id, sort_order, item_key, label, needs_photo, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      newId,
      it.sort_order,
      itemKey(),
      it.label,
      it.needs_photo,
      it.note,
    );
  }
  return c.redirect(to(`/admin/templates/${newId}`, "複製しました"));
});

admin.post("/templates/:id/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const t = await one(c.env.DB, "SELECT id FROM checklist_template WHERE id = ?", id);
  if (!t) return c.notFound();
  const inUse =
    (await one(c.env.DB, "SELECT COUNT(*) AS c FROM room r WHERE r.template_id = ?", id))?.c || 0;
  if (inUse > 0) return renderEditor(c, id, { err: `${inUse} 件の間取りに割当中のため削除できません` });
  await run(c.env.DB, "DELETE FROM checklist_template_item WHERE template_id = ?", id);
  await run(c.env.DB, "DELETE FROM checklist_template WHERE id = ?", id);
  return c.redirect(to("/admin/templates", "テンプレートを削除しました"));
});

// ── テンプレ項目 ──
function validateItem(body) {
  const label = String(body.label || "").trim();
  const note = String(body.note || "").trim();
  const needs_photo = body.needs_photo === "1" ? 1 : 0;
  const errs = [];
  if (label.length < 1 || label.length > 120) errs.push("ラベルは1〜120文字です");
  return { data: { label, note: note || null, needs_photo }, errs };
}

admin.post("/templates/:id/items", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const t = await one(c.env.DB, "SELECT id FROM checklist_template WHERE id = ?", id);
  if (!t) return c.notFound();
  const { data, errs } = validateItem(body);
  if (errs.length) return renderEditor(c, id, { err: errs.join(" / ") });
  const next =
    (await one(
      c.env.DB,
      "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM checklist_template_item WHERE template_id = ?",
      id,
    ))?.n || 1;
  await run(
    c.env.DB,
    `INSERT INTO checklist_template_item (template_id, sort_order, item_key, label, needs_photo, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    next,
    itemKey(),
    data.label,
    data.needs_photo,
    data.note,
  );
  await touchTemplate(c.env.DB, id);
  return c.redirect(to(`/admin/templates/${id}`, "項目を追加しました"));
});

admin.post("/templates/:id/items/:iid", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const iid = parseInt(c.req.param("iid"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const it = await one(
    c.env.DB,
    "SELECT id FROM checklist_template_item WHERE id = ? AND template_id = ?",
    iid,
    id,
  );
  if (!it) return c.notFound();
  const { data, errs } = validateItem(body);
  if (errs.length) return renderEditor(c, id, { err: errs.join(" / ") });
  await run(
    c.env.DB,
    "UPDATE checklist_template_item SET label = ?, needs_photo = ?, note = ? WHERE id = ?",
    data.label,
    data.needs_photo,
    data.note,
    iid,
  );
  await touchTemplate(c.env.DB, id);
  return c.redirect(to(`/admin/templates/${id}`, "項目を保存しました"));
});

admin.post("/templates/:id/items/:iid/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const iid = parseInt(c.req.param("iid"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const it = await one(
    c.env.DB,
    "SELECT id FROM checklist_template_item WHERE id = ? AND template_id = ?",
    iid,
    id,
  );
  if (!it) return c.notFound();
  await run(c.env.DB, "DELETE FROM checklist_template_item WHERE id = ?", iid);
  await touchTemplate(c.env.DB, id);
  return c.redirect(to(`/admin/templates/${id}`, "項目を削除しました"));
});

admin.post("/templates/:id/items/:iid/move", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const iid = parseInt(c.req.param("iid"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const dir = body.dir === "down" ? "down" : "up";
  const it = await one(
    c.env.DB,
    "SELECT * FROM checklist_template_item WHERE id = ? AND template_id = ?",
    iid,
    id,
  );
  if (!it) return c.notFound();
  const siblings = await all(
    c.env.DB,
    "SELECT id, sort_order FROM checklist_template_item WHERE template_id = ? ORDER BY sort_order, id",
    id,
  );
  const idx = siblings.findIndex((s) => s.id === iid);
  const j = dir === "up" ? idx - 1 : idx + 1;
  if (j >= 0 && j < siblings.length) {
    const a = siblings[idx];
    const b = siblings[j];
    await run(c.env.DB, "UPDATE checklist_template_item SET sort_order = ? WHERE id = ?", b.sort_order, a.id);
    await run(c.env.DB, "UPDATE checklist_template_item SET sort_order = ? WHERE id = ?", a.sort_order, b.id);
    await touchTemplate(c.env.DB, id);
  }
  return c.redirect(`/admin/templates/${id}`);
});

async function touchTemplate(db, id) {
  await run(db, "UPDATE checklist_template SET updated_at = ? WHERE id = ?", nowIso(), id);
}

// ─────────────────────────────────────────────
// ユーザー管理
// ─────────────────────────────────────────────
async function renderUsers(c, extra = {}) {
  const nowT = nowIso();
  const rows = await all(
    c.env.DB,
    "SELECT id, name, role, active, locked_until FROM user ORDER BY id",
  );
  const users = rows.map((u) => ({
    ...u,
    locked: !!u.locked_until && u.locked_until > nowT,
  }));
  const registrationOpen = (await getMeta(c.env.DB, "registration_open", "1")) === "1";
  const inviteUrl = c.env.SETUP_TOKEN
    ? `${new URL(c.req.url).origin}/register?token=${c.env.SETUP_TOKEN}`
    : null;
  return userList(c, {
    users,
    registrationOpen,
    inviteUrl,
    msg: c.req.query("msg"),
    ...extra,
  });
}

async function activeAdminCount(db) {
  return (await one(db, "SELECT COUNT(*) AS c FROM user WHERE role = 'admin' AND active = 1"))?.c || 0;
}

admin.get("/users", (c) => renderUsers(c));

admin.post("/users/:id/name", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const target = await one(c.env.DB, "SELECT id FROM user WHERE id = ?", id);
  if (!target) return c.notFound();
  const name = String(body.name || "").trim();
  if (name.length < 1 || name.length > 30) {
    return renderUsers(c, { err: "表示名は1〜30文字で入力してください" });
  }
  const clash = await one(
    c.env.DB,
    "SELECT id FROM user WHERE name = ? AND id <> ?",
    name,
    id,
  );
  if (clash) return renderUsers(c, { err: "その表示名は既に使われています" });
  await run(c.env.DB, "UPDATE user SET name = ? WHERE id = ?", name, id);
  return c.redirect(to("/admin/users", "表示名を変更しました"));
});

admin.post("/users/:id/role", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const target = await one(c.env.DB, "SELECT id, role, active FROM user WHERE id = ?", id);
  if (!target) return c.notFound();
  const role = body.role === "admin" ? "admin" : "member";
  if (role === "member" && target.role === "admin" && (await activeAdminCount(c.env.DB)) <= 1) {
    return renderUsers(c, { err: "管理者が0人になるため変更できません" });
  }
  await run(c.env.DB, "UPDATE user SET role = ? WHERE id = ?", role, id);
  return c.redirect(to("/admin/users", "権限を変更しました"));
});

admin.post("/users/:id/toggle", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  if (id === c.get("user").id) return renderUsers(c, { err: "自分自身は無効化できません" });
  const target = await one(c.env.DB, "SELECT id, role, active FROM user WHERE id = ?", id);
  if (!target) return c.notFound();
  if (target.active && target.role === "admin" && (await activeAdminCount(c.env.DB)) <= 1) {
    return renderUsers(c, { err: "管理者が0人になるため無効化できません" });
  }
  await run(c.env.DB, "UPDATE user SET active = ? WHERE id = ?", target.active ? 0 : 1, id);
  return c.redirect(to("/admin/users", target.active ? "無効化しました" : "有効化しました"));
});

admin.post("/users/:id/reset-pin", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const target = await one(c.env.DB, "SELECT id, name FROM user WHERE id = ?", id);
  if (!target) return c.notFound();
  const pin = randomPin(6);
  await run(
    c.env.DB,
    "UPDATE user SET pin_hash = ?, failed_count = 0, locked_until = NULL WHERE id = ?",
    await hashPin(pin),
    id,
  );
  return renderUsers(c, { newPin: { name: target.name, pin } });
});

admin.post("/registration", async (c) => {
  const body = await form(c);
  if (!body) return badReq(c);
  const open = body.open === "1" ? "1" : "0";
  await setMeta(c.env.DB, "registration_open", open);
  return c.redirect(to("/admin/users", open === "1" ? "登録受付を再開しました" : "登録受付を停止しました"));
});
