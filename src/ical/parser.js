// iCalendar (RFC 5545) の最小パーサ。Airbnb Hosting Calendar 用。
// 参照: docs/02_基本設計書.md §5.1 / §5.3（実データで検証済み 2026-09-08）

/** 折り返し（CRLF or LF + 空白/タブ）を解除して行配列にする */
function unfold(text) {
  return text
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .replace(/\r[ \t]/g, "")
    .split(/\r\n|\r|\n/);
}

/** "KEY;PARAM=x:VALUE" を { name, params, value } に分解 */
function parseLine(line) {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(";");
  const name = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq > 0) params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
  }
  return { name, params, value };
}

/** RFC5545 TEXT のエスケープ解除（\n \, \; \\） */
export function unescapeText(v) {
  return String(v)
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** "20260912" / "20260912T130000Z" → "2026-09-12"（取れなければ null） */
export function toIsoDate(v) {
  const m = String(v).match(/^\s*(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * VCALENDAR 本文から VEVENT を抽出する。
 * @returns {Array<{uid,summary,description,dtstart,dtend,raw}>}
 */
export function parseEvents(text) {
  const lines = unfold(String(text || ""));
  const events = [];
  let cur = null;
  let raw = [];
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      raw = [line];
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) {
        raw.push(line);
        cur.raw = raw.join("\n");
        events.push(cur);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    raw.push(line);
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case "UID":
        cur.uid = p.value.trim();
        break;
      case "SUMMARY":
        cur.summary = unescapeText(p.value).trim();
        break;
      case "DESCRIPTION":
        cur.description = unescapeText(p.value);
        break;
      case "DTSTART":
        cur.dtstart = toIsoDate(p.value);
        break;
      case "DTEND":
        cur.dtend = toIsoDate(p.value);
        break;
    }
  }
  return events;
}

const RES_URL_RE = /Reservation URL:\s*(\S+)/i;
const PHONE_RE = /Last 4 Digits\)\s*:?\s*(\d{4})/i;

/**
 * VEVENT を Airbnb の「予約」/「ブロック」に分類する。
 * ブロック（Airbnb (Not available) 等）や予約と判定できないものは kind:'block'。
 */
export function classifyEvent(ev) {
  const summary = ev.summary || "";
  const desc = ev.description || "";
  const isBlock = /not available/i.test(summary);
  const looksReserved = /reserved/i.test(summary) || RES_URL_RE.test(desc);

  if (isBlock || !looksReserved) return { kind: "block" };

  return {
    kind: "reservation",
    uid: ev.uid || null,
    checkin_date: ev.dtstart || null,
    checkout_date: ev.dtend || null,
    guest_hint: (desc.match(PHONE_RE) || [])[1] || null, // 電話下4桁のみ（docs §5.1）
    raw: ev.raw || "",
  };
}
