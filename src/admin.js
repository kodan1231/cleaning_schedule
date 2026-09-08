// 管理画面（admin のみ）: 物件・テンプレート・ユーザー管理。
// 参照: docs/02_基本設計書.md §2, §4.4, §6.1 / docs/05_実装計画.md P2

import { Hono } from "hono";
import { one, all, run, getMeta, setMeta } from "./db/queries.js";
import { requireAuth, requireAdmin, verifyCsrf, hashPin } from "./auth.js";
import { itemKey, randomPin } from "./lib/ids.js";
import { nowIso } from "./lib/datetime.js";
import { syncProperty, runScheduledSync } from "./ical/sync.js";
import {
  adminHome,
  propertyList,
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
    `SELECT p.id, p.name, p.active, t.name AS tpl,
       (SELECT s.run_at FROM sync_log s WHERE s.property_id = p.id ORDER BY s.run_at DESC LIMIT 1) AS last_sync,
       (SELECT s.result FROM sync_log s WHERE s.property_id = p.id ORDER BY s.run_at DESC LIMIT 1) AS last_result
     FROM property p
     LEFT JOIN checklist_template t ON t.id = p.template_id
     ORDER BY p.active DESC, p.id`,
  );
  const syncLogs = await all(
    db,
    `SELECT s.run_at, s.result, s.reservations_seen, s.cleanings_created, s.cleanings_updated,
            s.message, p.name AS property
     FROM sync_log s LEFT JOIN property p ON p.id = s.property_id
     ORDER BY s.run_at DESC LIMIT 15`,
  );
  return adminHome(c, { counts, properties, syncLogs, msg: c.req.query("msg") });
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
      ? `同期しました（予約 ${r.seen} / 生成 ${r.created} / 更新 ${r.updated} / キャンセル ${r.cancelled}）`
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
    "SELECT id, name, ical_url, active FROM property ORDER BY active DESC, id",
  );
  return propertyList(c, { properties, msg: c.req.query("msg") });
});

async function loadTemplates(db) {
  return all(db, "SELECT id, name FROM checklist_template ORDER BY is_base DESC, id");
}

function validateProperty(body) {
  const name = String(body.name || "").trim();
  const ical_url = String(body.ical_url || "").trim();
  const checkout_time = String(body.checkout_time || "").trim();
  const note = String(body.note || "").trim();
  let template_id = String(body.template_id || "").trim();
  template_id = template_id === "" ? null : parseInt(template_id, 10);
  const errs = [];
  if (name.length < 1 || name.length > 60) errs.push("物件名は1〜60文字で入力してください");
  if (!/^https?:\/\//.test(ical_url) || ical_url.length > 500)
    errs.push("iCal URL は http(s) から始まる正しい URL を入力してください");
  if (!/^\d{2}:\d{2}$/.test(checkout_time)) errs.push("チェックアウト時刻を入力してください");
  return { data: { name, ical_url, checkout_time, note, template_id }, errs };
}

admin.post("/properties", async (c) => {
  const body = await form(c);
  if (!body) return badReq(c);
  const { data, errs } = validateProperty(body);
  if (errs.length) {
    return propertyForm(c, {
      p: null,
      templates: await loadTemplates(c.env.DB),
      err: errs.join(" / "),
    });
  }
  await run(
    c.env.DB,
    `INSERT INTO property (name, ical_url, active, checkout_time, template_id, note, created_at)
     VALUES (?, ?, 1, ?, ?, ?, ?)`,
    data.name,
    data.ical_url,
    data.checkout_time,
    data.template_id,
    data.note || null,
    nowIso(),
  );
  return c.redirect(to("/admin/properties", "物件を追加しました"));
});

admin.get("/properties/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const p = await one(c.env.DB, "SELECT * FROM property WHERE id = ?", id);
  if (!p) return c.notFound();
  return propertyForm(c, {
    p,
    templates: await loadTemplates(c.env.DB),
    msg: c.req.query("msg"),
  });
});

admin.post("/properties/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await form(c);
  if (!body) return badReq(c);
  const p = await one(c.env.DB, "SELECT * FROM property WHERE id = ?", id);
  if (!p) return c.notFound();
  const { data, errs } = validateProperty(body);
  if (errs.length) {
    return propertyForm(c, { p: { ...p, ...data }, templates: await loadTemplates(c.env.DB), err: errs.join(" / ") });
  }
  await run(
    c.env.DB,
    `UPDATE property SET name = ?, ical_url = ?, checkout_time = ?, template_id = ?, note = ?
     WHERE id = ?`,
    data.name,
    data.ical_url,
    data.checkout_time,
    data.template_id,
    data.note || null,
    id,
  );
  return c.redirect(to(`/admin/properties/${id}`, "保存しました"));
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
admin.get("/templates", async (c) => {
  const templates = await all(
    c.env.DB,
    `SELECT t.id, t.name, t.is_base,
       (SELECT COUNT(*) FROM checklist_template_item i WHERE i.template_id = t.id) AS items,
       (SELECT COUNT(*) FROM property p WHERE p.template_id = t.id) AS props
     FROM checklist_template t
     ORDER BY t.is_base DESC, t.id`,
  );
  return templateList(c, { templates, msg: c.req.query("msg") });
});

admin.post("/templates", async (c) => {
  const body = await form(c);
  if (!body) return badReq(c);
  const name = String(body.name || "").trim();
  if (name.length < 1 || name.length > 60) {
    const templates = await all(
      c.env.DB,
      `SELECT t.id, t.name, t.is_base, 0 AS items, 0 AS props FROM checklist_template t ORDER BY t.is_base DESC, t.id`,
    );
    return templateList(c, { templates, err: "名称は1〜60文字で入力してください" });
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
    "SELECT * FROM checklist_template_item WHERE template_id = ? ORDER BY area_label, sort_order, id",
    id,
  );
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.area_label)) map.set(it.area_label, []);
    map.get(it.area_label).push(it);
  }
  const areas = [...map.entries()].map(([label, list]) => ({ label, items: list }));
  const propCount =
    (await one(c.env.DB, "SELECT COUNT(*) AS c FROM property WHERE template_id = ?", id))?.c || 0;
  return templateEditor(c, { t, areas, propCount, msg: c.req.query("msg"), ...extra });
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
    "SELECT area_label, sort_order, label, needs_photo, note FROM checklist_template_item WHERE template_id = ?",
    id,
  );
  for (const it of items) {
    await run(
      c.env.DB,
      `INSERT INTO checklist_template_item (template_id, area_label, sort_order, item_key, label, needs_photo, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId,
      it.area_label,
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
  const t = await one(c.env.DB, "SELECT * FROM checklist_template WHERE id = ?", id);
  if (!t) return c.notFound();
  if (t.is_base) return renderEditor(c, id, { err: "ベーステンプレートは削除できません" });
  const inUse =
    (await one(c.env.DB, "SELECT COUNT(*) AS c FROM property WHERE template_id = ?", id))?.c || 0;
  if (inUse > 0) return renderEditor(c, id, { err: `${inUse} 件の物件に割当中のため削除できません` });
  await run(c.env.DB, "DELETE FROM checklist_template_item WHERE template_id = ?", id);
  await run(c.env.DB, "DELETE FROM checklist_template WHERE id = ?", id);
  return c.redirect(to("/admin/templates", "テンプレートを削除しました"));
});

// ── テンプレ項目 ──
function validateItem(body) {
  const area_label = String(body.area_label || "").trim();
  const label = String(body.label || "").trim();
  const note = String(body.note || "").trim();
  const needs_photo = body.needs_photo === "1" ? 1 : 0;
  const errs = [];
  if (area_label.length < 1 || area_label.length > 40) errs.push("エリアは1〜40文字です");
  if (label.length < 1 || label.length > 120) errs.push("ラベルは1〜120文字です");
  return { data: { area_label, label, note: note || null, needs_photo }, errs };
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
      "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM checklist_template_item WHERE template_id = ? AND area_label = ?",
      id,
      data.area_label,
    ))?.n || 1;
  await run(
    c.env.DB,
    `INSERT INTO checklist_template_item (template_id, area_label, sort_order, item_key, label, needs_photo, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.area_label,
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
    "SELECT * FROM checklist_template_item WHERE id = ? AND template_id = ?",
    iid,
    id,
  );
  if (!it) return c.notFound();
  const { data, errs } = validateItem(body);
  if (errs.length) return renderEditor(c, id, { err: errs.join(" / ") });
  // エリアが変わったら移動先の末尾に付け直す
  let sort_order = it.sort_order;
  if (data.area_label !== it.area_label) {
    sort_order =
      (await one(
        c.env.DB,
        "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM checklist_template_item WHERE template_id = ? AND area_label = ?",
        id,
        data.area_label,
      ))?.n || 1;
  }
  await run(
    c.env.DB,
    "UPDATE checklist_template_item SET area_label = ?, label = ?, needs_photo = ?, note = ?, sort_order = ? WHERE id = ?",
    data.area_label,
    data.label,
    data.needs_photo,
    data.note,
    sort_order,
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
    "SELECT id, sort_order FROM checklist_template_item WHERE template_id = ? AND area_label = ? ORDER BY sort_order, id",
    id,
    it.area_label,
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
  const maxUsers = parseInt(await getMeta(c.env.DB, "max_users", "4"), 10) || 4;
  return userList(c, {
    users,
    registrationOpen,
    maxUsers,
    msg: c.req.query("msg"),
    ...extra,
  });
}

async function activeAdminCount(db) {
  return (await one(db, "SELECT COUNT(*) AS c FROM user WHERE role = 'admin' AND active = 1"))?.c || 0;
}

admin.get("/users", (c) => renderUsers(c));

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
