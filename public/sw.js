// Service Worker。
// - install: オフライン用にアプリシェルをプリキャッシュ
// - app.js / app.css / manifest / 画面遷移 / API: network-first
//   （オンライン時は必ず最新。失敗時のみキャッシュ → オフラインページ）
// - アイコン・フォント等の不変資産: cache-first
// - 写真 /photos/*: stale-while-revalidate（件数上限で古いものから破棄）
//
// 注意: app.js / app.css を cache-first にすると、デプロイしても古い JS/CSS が
// 使われ続けて不整合になる（過去にトグルが毎回失敗する不具合の原因）。必ず network-first。

const VERSION = "v2";
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
// 内容がファイル名で固定される不変資産だけ cache-first
const IMMUTABLE = /\.(png|jpe?g|svg|ico|webp|woff2?)$/i;

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
  if (IMMUTABLE.test(url.pathname)) {
    e.respondWith(cacheFirst(request));
    return;
  }
  // app.js / app.css / manifest / 画面遷移 / API
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
    return new Response("オフラインです", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
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
