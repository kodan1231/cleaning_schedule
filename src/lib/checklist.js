// チェックリスト関連の共有ヘルパ。

import { all, run } from "../db/queries.js";

/**
 * テンプレ項目を checklist_item にコピーする（FR-10 スナップショット）。
 * cleaning 生成時（iCal 同期・臨時清掃）に呼ぶ。以後テンプレ変更の影響を受けない。
 */
export async function snapshotChecklist(db, cleaningId, templateId) {
  if (!templateId) return 0;
  const items = await all(
    db,
    `SELECT area_label, sort_order, item_key, label, needs_photo, note
       FROM checklist_template_item
      WHERE template_id = ?
      ORDER BY area_label, sort_order, id`,
    templateId,
  );
  for (const it of items) {
    await run(
      db,
      `INSERT INTO checklist_item
         (cleaning_id, area_label, sort_order, item_key, label, needs_photo, note, checked)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      cleaningId,
      it.area_label,
      it.sort_order,
      it.item_key,
      it.label,
      it.needs_photo,
      it.note,
    );
  }
  return items.length;
}

/** checklist_item をエリア別にまとめる。[{ label, items:[...] }] */
export function groupByArea(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.area_label)) map.set(it.area_label, []);
    map.get(it.area_label).push(it);
  }
  return [...map.entries()].map(([label, list]) => ({ label, items: list }));
}
