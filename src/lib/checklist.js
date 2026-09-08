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
    "SELECT id, name, sort_order, template_id FROM room WHERE property_id = ? ORDER BY sort_order, id",
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
           (cleaning_id, room_name, room_sort, sort_order, item_key, label, needs_photo, note, checked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        cleaningId,
        room.name,
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

/** checklist_item を間取り別にまとめる。[{ name, items:[...] }]（room_sort 順） */
export function groupByRoom(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.room_name)) map.set(it.room_name, { sort: it.room_sort, items: [] });
    map.get(it.room_name).items.push(it);
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, sort: v.sort, items: v.items }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}
