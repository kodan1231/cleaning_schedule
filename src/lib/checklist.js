// チェックリスト関連の共有ヘルパ。

import { all, run } from "../db/queries.js";
import { itemKey } from "./ids.js";

/**
 * 物件の全間取りのチェック項目を checklist_item にコピーする（スナップショット）。
 * 各間取りで〈共有テンプレの項目 → その間取り固有の追加項目（room_item）〉の順に展開する。
 * cleaning 生成時（iCal 同期・臨時清掃）に呼ぶ。以後テンプレ・間取り変更の影響を受けない。
 * @returns コピーした項目数
 */
export async function snapshotChecklist(db, cleaningId, propertyId) {
  const rooms = await all(
    db,
    "SELECT id, name, sort_order, template_id FROM room WHERE property_id = ? ORDER BY sort_order, id",
    propertyId,
  );
  let n = 0;
  for (const room of rooms) {
    let order = 0; // 間取り内の連番（テンプレ項目→追加項目で通し）
    if (room.template_id) {
      const items = await all(
        db,
        `SELECT item_key, label, needs_photo, note
           FROM checklist_template_item
          WHERE template_id = ?
          ORDER BY sort_order, id`,
        room.template_id,
      );
      for (const it of items) {
        await insertItem(db, cleaningId, room, order++, it.item_key, it);
        n++;
      }
    }
    const extra = await all(
      db,
      `SELECT label, needs_photo, note FROM room_item WHERE room_id = ? ORDER BY sort_order, id`,
      room.id,
    );
    for (const it of extra) {
      await insertItem(db, cleaningId, room, order++, itemKey(), it);
      n++;
    }
  }
  return n;
}

async function insertItem(db, cleaningId, room, sortOrder, key, it) {
  await run(
    db,
    `INSERT INTO checklist_item
       (cleaning_id, room_name, room_sort, sort_order, item_key, label, needs_photo, note, checked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    cleaningId,
    room.name,
    room.sort_order,
    sortOrder,
    key,
    it.label,
    it.needs_photo,
    it.note,
  );
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

/** checklist_item を間取り別にまとめる。[{ name, done, total, items }]（room_sort 順） */
export function groupByRoom(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.room_name)) map.set(it.room_name, { sort: it.room_sort, items: [] });
    map.get(it.room_name).items.push(it);
  }
  return [...map.entries()]
    .map(([name, v]) => ({
      name,
      sort: v.sort,
      items: v.items,
      done: v.items.filter((i) => i.checked).length,
      total: v.items.length,
    }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}
