// D1 アクセスの薄いラッパ。各機能フェーズでクエリを追加していく。

/** 1行取得。無ければ null */
export async function one(db, sql, ...params) {
  return (await db.prepare(sql).bind(...params).first()) ?? null;
}

/** 全行取得（results 配列） */
export async function all(db, sql, ...params) {
  const { results } = await db.prepare(sql).bind(...params).all();
  return results ?? [];
}

/** 実行して meta を返す（last_row_id, changes 等） */
export async function run(db, sql, ...params) {
  const { meta } = await db.prepare(sql).bind(...params).run();
  return meta;
}

/** app_meta の取得 / 設定 */
export async function getMeta(db, key, fallback = null) {
  const row = await one(db, "SELECT value FROM app_meta WHERE key = ?", key);
  return row ? row.value : fallback;
}

export async function setMeta(db, key, value) {
  await run(
    db,
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    String(value),
  );
}

/** DB 疎通確認（/healthz 用） */
export async function ping(db) {
  const row = await one(db, "SELECT 1 AS ok");
  return row?.ok === 1;
}
