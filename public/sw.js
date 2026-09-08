// Service Worker（P7）。
// - install: アプリシェルをプリキャッシュ
// - 静的資産（CSS/JS/アイコン/manifest）: cache-first
// - 画面遷移・API: network-first（失敗時 キャッシュ → オフラインページ）
// - 写真 /photos/*: stale-while-revalidate（件数上限で古いものから破棄）

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const PHOTOS = `photos-${VERSION}`;
const PHOTO_MAX = 80;

const SHELL_ASSETS = [
  "/app.css",
  "/app.js",
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];
const STATIC_EXT = /\.(css|js|png|jpg|jpeg|svg|webmanifest|ico|woff2?)$/i;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => ![SHELL, RUNTIME, PHOTOS].includes(k)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/photos/")) {
    e.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (STATIC_EXT.test(url.pathname)) {
    e.respondWith(cacheFirst(request));
    return;
  }
  // 画面遷移・その他（API 含む）
  e.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok && request.mode !== "navigate") {
      (await caches.open(RUNTIME)).put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const offline = await caches.match("/offline");
      if (offline) return offline;
    }
    return new Response("オフラインです", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(PHOTOS);
  const cached = await cache.match(request);
  const fetching = fetch(request)
    .then(async (res) => {
      if (res.ok) {
        await cache.put(request, res.clone());
        trimCache(cache, PHOTO_MAX);
      }
      return res;
    })
    .catch(() => cached);
  return cached || fetching;
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const k of keys.slice(0, keys.length - max)) await cache.delete(k);
}
