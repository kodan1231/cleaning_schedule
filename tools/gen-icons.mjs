// PWA アイコン生成（依存なし・pure Node）。
//   node tools/gen-icons.mjs
// 緑背景 + 白いチェックマーク。any 用（192/512）と maskable 用（512・余白広め）を出力。

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const GREEN = [47, 111, 79]; // #2f6f4f
const WHITE = [255, 255, 255];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// 点 p と線分 ab の距離
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function makeIcon(size, pad) {
  const rgba = new Uint8Array(size * size * 4);
  // チェックマークの3点（正規化 0..1 → 内側 pad..1-pad）
  const s = (v) => pad + v * (1 - 2 * pad);
  const p = [
    [s(0.14), s(0.52)],
    [s(0.4), s(0.78)],
    [s(0.86), s(0.24)],
  ].map(([x, y]) => [x * size, y * size]);
  const stroke = size * (0.5 - pad) * 0.34;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(
        distToSeg(x, y, p[0][0], p[0][1], p[1][0], p[1][1]),
        distToSeg(x, y, p[1][0], p[1][1], p[2][0], p[2][1]),
      );
      // アンチエイリアス 1px
      const a = Math.max(0, Math.min(1, stroke - d + 0.5));
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(GREEN[0] + (WHITE[0] - GREEN[0]) * a);
      rgba[i + 1] = Math.round(GREEN[1] + (WHITE[1] - GREEN[1]) * a);
      rgba[i + 2] = Math.round(GREEN[2] + (WHITE[2] - GREEN[2]) * a);
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(new URL("../public/icons/", import.meta.url), { recursive: true });
const out = (name, buf) => {
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), buf);
  console.log(name, buf.length, "bytes");
};
out("icon-192.png", makeIcon(192, 0.18));
out("icon-512.png", makeIcon(512, 0.18));
out("icon-512-maskable.png", makeIcon(512, 0.3));
