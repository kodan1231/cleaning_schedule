// 最小の HTML ユーティリティ。

/** HTML エスケープ */
export function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * タグ付きテンプレート。埋め込み値は自動エスケープ。
 * 生 HTML を埋めたいときは raw() でラップする。
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out += (v && v.__raw !== undefined ? v.__raw : escList(v)) + strings[i + 1];
  }
  return raw(out);
}

function escList(v) {
  if (Array.isArray(v)) return v.map((x) => (x && x.__raw !== undefined ? x.__raw : esc(x))).join("");
  return esc(v);
}

/** 信頼できる HTML 文字列としてマーク */
export function raw(s) {
  return { __raw: s == null ? "" : String(s) };
}

/** raw/オブジェクトを最終的な文字列へ */
export function render(node) {
  return node && node.__raw !== undefined ? node.__raw : esc(node);
}
