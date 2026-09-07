// 認証・登録まわり: PIN ハッシュ、セッション cookie 署名、CSRF、ミドルウェア。
// 参照: docs/02_基本設計書.md §6

import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { one } from "./db/queries.js";
import { html } from "./lib/html.js";
import { page } from "./views/layout.js";

const ENC = new TextEncoder();
const DEC = new TextDecoder();

const PBKDF2_ITER = 210000;
const SESSION_TTL = 90 * 24 * 3600; // 秒（90日）

const SESS_COOKIE = "sess";
const CSRF_COOKIE = "csrf";

// 本番(https)では Secure。ローカル dev(http) では付けない。
function cookieBase(c) {
  const secure = (() => {
    try {
      return new URL(c.req.url).protocol === "https:";
    } catch {
      return true;
    }
  })();
  return { path: "/", secure, sameSite: "Lax" };
}

// ───────────────────────── base64url ─────────────────────────
function b64urlEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  let s = String(str).replaceAll("-", "+").replaceAll("_", "/");
  if (s.length % 4) s += "=".repeat(4 - (s.length % 4));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function timingSafeEqual(a, b) {
  const ua = a instanceof Uint8Array ? a : ENC.encode(String(a));
  const ub = b instanceof Uint8Array ? b : ENC.encode(String(b));
  if (ua.length !== ub.length) return false;
  let r = 0;
  for (let i = 0; i < ua.length; i++) r |= ua[i] ^ ub[i];
  return r === 0;
}

// ───────────────────────── PIN ハッシュ ─────────────────────────
async function pbkdf2(pin, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", ENC.encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** PIN をハッシュ文字列に: pbkdf2$<iter>$<salt_b64url>$<hash_b64url> */
export async function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(pin, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

/** 平文 PIN と保存済みハッシュを照合 */
export async function verifyPin(pin, stored) {
  try {
    const [scheme, iterStr, saltB64, hashB64] = String(stored).split("$");
    if (scheme !== "pbkdf2") return false;
    const salt = b64urlDecode(saltB64);
    const expected = b64urlDecode(hashB64);
    const actual = await pbkdf2(pin, salt, parseInt(iterStr, 10));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ───────────────────────── HMAC / セッション ─────────────────────────
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    ENC.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, ENC.encode(data)));
}

/** セッショントークン発行: <payload_b64url>.<sig_b64url> */
export async function signSession(secret, { uid, role }) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = { uid, role, iat, exp: iat + SESSION_TTL };
  const p = b64urlEncode(ENC.encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(secret, p));
  return `${p}.${sig}`;
}

/** 検証。正当なら { uid, role }、不正・失効なら null */
export async function verifySession(secret, token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [p, sig] = token.split(".");
  const expected = b64urlEncode(await hmac(secret, p));
  if (!timingSafeEqual(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(DEC.decode(b64urlDecode(p)));
  } catch {
    return null;
  }
  if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { uid: payload.uid, role: payload.role };
}

export function setSessionCookie(c, token) {
  setCookie(c, SESS_COOKIE, token, { ...cookieBase(c), httpOnly: true, maxAge: SESSION_TTL });
}

export function clearAuthCookies(c) {
  deleteCookie(c, SESS_COOKIE, { path: "/" });
  deleteCookie(c, CSRF_COOKIE, { path: "/" });
}

// ───────────────────────── CSRF（double-submit cookie）─────────────────────────
/** GET でフォームを描画する前に呼ぶ。cookie が無ければ発行してトークンを返す */
export function ensureCsrf(c) {
  let tok = getCookie(c, CSRF_COOKIE);
  if (!tok) {
    tok = b64urlEncode(randomBytes(18));
    setCookie(c, CSRF_COOKIE, tok, { ...cookieBase(c), httpOnly: false, maxAge: SESSION_TTL });
  }
  return tok;
}

/** POST 時: cookie と body._csrf の一致 + 同一オリジンを検証 */
export function verifyCsrf(c, body) {
  const cookieTok = getCookie(c, CSRF_COOKIE);
  if (!cookieTok) return false;
  const origin = c.req.header("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(c.req.url).host) return false;
    } catch {
      return false;
    }
  }
  const formTok = body && typeof body._csrf === "string" ? body._csrf : "";
  return timingSafeEqual(formTok, cookieTok);
}

// ───────────────────────── ミドルウェア ─────────────────────────
/** ログイン必須。c.set('user'), c.set('csrf') を確立 */
export function requireAuth() {
  return async (c, next) => {
    const token = getCookie(c, SESS_COOKIE);
    const sess = token ? await verifySession(c.env.SESSION_SECRET, token) : null;
    if (!sess) {
      const u = new URL(c.req.url);
      const dest = encodeURIComponent(u.pathname + u.search);
      return c.redirect(`/login?next=${dest}`);
    }
    const user = await one(
      c.env.DB,
      "SELECT id, name, role, active FROM user WHERE id = ?",
      sess.uid,
    );
    if (!user || !user.active) {
      clearAuthCookies(c);
      return c.redirect("/login");
    }
    c.set("user", user);
    c.set("csrf", ensureCsrf(c));
    await next();
  };
}

/** 管理者必須（requireAuth の後段で使う） */
export function requireAdmin() {
  return async (c, next) => {
    const user = c.get("user");
    if (!user || user.role !== "admin") {
      return page(
        c,
        {
          title: "権限がありません",
          appName: c.env.APP_NAME,
          user,
          csrf: c.get("csrf"),
          body: html`
            <h1>403</h1>
            <p class="muted">この操作には管理者権限が必要です。</p>
            <p><a href="/">トップへ</a></p>
          `,
        },
        403,
      );
    }
    await next();
  };
}

/** next パラメータの検証（オープンリダイレクト防止） */
export function safeNext(v) {
  const s = String(v || "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "";
}
