// 短い一意キー生成。

/** テンプレ項目の安定キー（テンプレ内で一意・UI 非表示） */
export function itemKey() {
  return "it_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** 数字 n 桁のランダム PIN（PIN リセット用） */
export function randomPin(digits = 6) {
  const buf = new Uint32Array(1);
  let out = "";
  while (out.length < digits) {
    crypto.getRandomValues(buf);
    out += String(buf[0] % 10);
  }
  return out.slice(0, digits);
}
