// Service Worker。P7 でキャッシュ戦略を本実装。
// P0 では最小限（インストール即時有効化、ネットワークパススルー）。

const SHELL = "shell-v0";
const SHELL_ASSETS = ["/app.css", "/app.js", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // 静的シェルは cache-first
  if (SHELL_ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(request).then((r) => r || fetch(request)));
    return;
  }
  // それ以外は network-first（失敗時のみキャッシュ）
  e.respondWith(
    fetch(request).catch(() => caches.match(request)),
  );
});
