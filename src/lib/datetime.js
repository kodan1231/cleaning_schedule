// 日時ヘルパ。保存は ISO8601 UTC、表示は Asia/Tokyo 固定（docs/01 Q7）。

const TZ = "Asia/Tokyo";

/** 現在時刻の ISO8601 UTC 文字列（秒精度）。例 "2026-09-07T04:30:00Z" */
export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** 今日の日付（Asia/Tokyo）を YYYY-MM-DD で返す */
export function todayJst() {
  return ymdInTz(new Date(), TZ);
}

/** 現在から min 分後の ISO8601 UTC 文字列 */
export function isoPlusMinutes(min) {
  return new Date(Date.now() + min * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Date を指定タイムゾーンの YYYY-MM-DD にする */
export function ymdInTz(date, tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** YYYY-MM-DD に日数を加算した YYYY-MM-DD を返す */
export function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO 日時文字列を Asia/Tokyo の "M/D HH:mm" 表示にする */
export function fmtDateTimeJst(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** YYYY-MM-DD を "M/D(曜)" 表示にする */
export function fmtDateJst(ymd) {
  if (!ymd) return "";
  const [, m, day] = ymd.split("-");
  const w = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    weekday: "short",
  }).format(new Date(`${ymd}T12:00:00Z`));
  return `${Number(m)}/${Number(day)}(${w})`;
}
