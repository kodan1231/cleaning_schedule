// チェックリスト関連の共有ヘルパ。

import { all, run } from "../db/queries.js";

/**
 * 物件の全間取りのテンプレ項目を checklist_item にコピーする（スナップショット）。
 * cleaning 生成時（iCal 同期・臨時清掃）に呼ぶ。以後テンプレ・間取り変更の影響を受けない。
 * @returns コピーした項目数
 */
export async function snapshotChecklist(db, cleaningId, propertyId) {
  const rooms = await all(
    db,
    `SELECT id, name, group_label, sort_order, template_id
       FROM room WHERE property_id = ? ORDER BY sort_order, id`,
    propertyId,
  );
  let n = 0;
  for (const room of rooms) {
    if (!room.template_id) continue;
    const items = await all(
      db,
      `SELECT sort_order, item_key, label, needs_photo, note
         FROM checklist_template_item
        WHERE template_id = ?
        ORDER BY sort_order, id`,
      room.template_id,
    );
    for (const it of items) {
      await run(
        db,
        `INSERT INTO checklist_item
           (cleaning_id, room_name, room_group, room_sort, sort_order, item_key, label, needs_photo, note, checked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        cleaningId,
        room.name,
        room.group_label || null,
        room.sort_order,
        it.sort_order,
        it.item_key,
        it.label,
        it.needs_photo,
        it.note,
      );
      n++;
    }
  }
  return n;
}

/**
 * 未着手/作業中の清掃のチェックリストを現在の間取り・テンプレで作り直す。
 * チェック済みが1件でもある清掃は、force が false のときスキップ（作業内容を守る）。
 * @returns 作り直した清掃 id の配列
 */
export async function resnapshotPending(db, propertyId, { force = false, includeInProgress = false } = {}) {
  const statuses = includeInProgress ? "('pending','in_progress')" : "('pending')";
  const cleanings = await all(
    db,
    `SELECT id FROM cleaning WHERE property_id = ? AND status IN ${statuses}`,
    propertyId,
  );
  const done = [];
  for (const cl of cleanings) {
    const checked =
      (await all(db, "SELECT 1 FROM checklist_item WHERE cleaning_id = ? AND checked = 1 LIMIT 1", cl.id))
        .length > 0;
    if (checked && !force) continue;
    await run(db, "DELETE FROM checklist_item WHERE cleaning_id = ?", cl.id);
    await snapshotChecklist(db, cl.id, propertyId);
    done.push(cl.id);
  }
  return done;
}

/** checklist_item を間取り別にまとめる。[{ name, group, sort, done, total, items }]（room_sort 順） */
export function groupByRoom(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.room_name)) {
      map.set(it.room_name, { group: it.room_group || null, sort: it.room_sort, items: [] });
    }
    map.get(it.room_name).items.push(it);
  }
  return [...map.entries()]
    .map(([name, v]) => ({
      name,
      group: v.group,
      sort: v.sort,
      items: v.items,
      done: v.items.filter((i) => i.checked).length,
      total: v.items.length,
    }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/**
 * 間取りをグループ（階など）でまとめる。
 * グループ未設定の間取りは group:null のセクションにまとめて末尾へ。
 * @returns [{ group, done, total, rooms:[room...] }]
 */
export function groupByFloor(rooms) {
  const map = new Map();
  for (const r of rooms) {
    const key = r.group || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  const sections = [...map.entries()].map(([key, rs]) => ({
    group: key || null,
    rooms: rs,
    done: rs.reduce((s, r) => s + r.done, 0),
    total: rs.reduce((s, r) => s + r.total, 0),
  }));
  // グループありを先、未設定を末尾に。グループ内は room_sort 順（rooms は既にソート済み）
  return sections.sort((a, b) => {
    if (!a.group && b.group) return 1;
    if (a.group && !b.group) return -1;
    return 0;
  });
}
