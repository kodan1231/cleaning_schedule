// クライアント JS。P5（チェック更新）・P6（画像リサイズ）で拡張。
// P0 では Service Worker 登録のみ。

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.warn("SW 登録失敗", e);
    });
  });
}
