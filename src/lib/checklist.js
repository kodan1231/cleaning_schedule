// チェックリスト関連の共有ヘルパ。

import { all, run } from "../db/queries.js";

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
    for (const it of await freshItemsForRoom(db, room)) {
      await insertItem(db, cleaningId, room, order++, it.item_key, it);
      n++;
    }
  }
  return n;
}

/** ある間取りの「現在の」項目一覧（テンプレ項目 → room_item の順）。item_key は安定キー */
async function freshItemsForRoom(db, room) {
  const items = [];
  if (room.template_id) {
    items.push(
      ...(await all(
        db,
        `SELECT item_key, label, needs_photo, note
           FROM checklist_template_item
          WHERE template_id = ?
          ORDER BY sort_order, id`,
        room.template_id,
      )),
    );
  }
  items.push(
    ...(await all(
      db,
      `SELECT item_key, label, needs_photo, note FROM room_item WHERE room_id = ? ORDER BY sort_order, id`,
      room.id,
    )),
  );
  return items;
}

async function insertItem(db, cleaningId, room, sortOrder, key, it) {
  await run(
    db,
    `INSERT INTO checklist_item
       (cleaning_id, room_name, room_sort, sort_order, item_key, label, needs_photo, note, checked, checked_by, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    cleaningId,
    room.name,
    room.sort_order,
    sortOrder,
    key,
    it.label,
    it.needs_photo,
    it.note,
    it.checked ? 1 : 0,
    it.checked_by ?? null,
    it.checked_at ?? null,
  );
}

/**
 * 未着手/作業中の清掃のチェックリストを、現在の間取り・テンプレで作り直す（マージ方式）。
 *   - 現行のテンプレ/room_item と同じ間取り＋安定キー(item_key)で対応付けられる項目は、
 *     既存の checklist_item 行を UPDATE で更新する（行を削除して作り直さない）。
 *     これは写真（photo.checklist_item_id）が項目の削除で自動的に外れてしまう
 *     （FK の ON DELETE SET NULL）のを防ぐための必須条件。
 *     - チェック済みならラベル等は更新せず元のまま固定、位置だけ更新。
 *     - 未チェックなら最新のラベル等に更新。
 *   - 対応付けられなかった既存項目は、チェック済み・または写真が添付されている場合に限り
 *     個別項目として残す（削除しない）。それ以外（未チェック・写真なし）は安全に削除する。
 * 完了・キャンセル済みの清掃は対象外。
 * @returns 作り直した清掃 id の配列
 */
export async function resnapshotPending(db, propertyId) {
  const cleanings = await all(
    db,
    "SELECT id FROM cleaning WHERE property_id = ? AND status IN ('pending','in_progress')",
    propertyId,
  );
  for (const cl of cleanings) {
    await mergeSnapshot(db, cl.id, propertyId);
  }
  return cleanings.map((c) => c.id);
}

async function mergeSnapshot(db, cleaningId, propertyId) {
  const existing = await all(db, "SELECT * FROM checklist_item WHERE cleaning_id = ?", cleaningId);
  const photoItemIds = new Set(
    (
      await all(
        db,
        "SELECT DISTINCT checklist_item_id FROM photo WHERE cleaning_id = ? AND checklist_item_id IS NOT NULL",
        cleaningId,
      )
    ).map((r) => r.checklist_item_id),
  );
  const usedIds = new Set();

  const rooms = await all(
    db,
    "SELECT id, name, sort_order, template_id FROM room WHERE property_id = ? ORDER BY sort_order, id",
    propertyId,
  );
  const nextOrderByRoomName = new Map();

  for (const room of rooms) {
    let order = 0;
    for (const it of await freshItemsForRoom(db, room)) {
      const match = existing.find(
        (c) => !usedIds.has(c.id) && c.room_name === room.name && c.item_key === it.item_key,
      );
      if (match) {
        usedIds.add(match.id);
        if (match.checked) {
          await run(
            db,
            "UPDATE checklist_item SET room_sort = ?, sort_order = ? WHERE id = ?",
            room.sort_order,
            order,
            match.id,
          );
        } else {
          await run(
            db,
            "UPDATE checklist_item SET room_sort = ?, sort_order = ?, label = ?, needs_photo = ?, note = ? WHERE id = ?",
            room.sort_order,
            order,
            it.label,
            it.needs_photo,
            it.note,
            match.id,
          );
        }
      } else {
        await insertItem(db, cleaningId, room, order, it.item_key, it);
      }
      order++;
    }
    nextOrderByRoomName.set(room.name, order);
  }

  // マッチしなかった既存項目: チェック済み or 写真添付があるものは個別項目として残し、位置だけ更新。
  // それ以外（未チェック・写真なし）は安全に削除できる。
  for (const c of existing) {
    if (usedIds.has(c.id)) continue;
    if (c.checked || photoItemIds.has(c.id)) {
      const room = rooms.find((r) => r.name === c.room_name);
      const roomSort = room ? room.sort_order : c.room_sort;
      const order = nextOrderByRoomName.get(c.room_name) ?? 0;
      nextOrderByRoomName.set(c.room_name, order + 1);
      await run(db, "UPDATE checklist_item SET room_sort = ?, sort_order = ? WHERE id = ?", roomSort, order, c.id);
    } else {
      await run(db, "DELETE FROM checklist_item WHERE id = ?", c.id);
    }
  }
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
