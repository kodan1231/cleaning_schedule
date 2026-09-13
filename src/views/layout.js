import { html, raw, render } from "../lib/html.js";

/**
 * 共通レイアウト。
 * @param {object} o
 * @param {string} o.title      ページタイトル
 * @param {object} [o.user]     現在ユーザー { name, role }
 * @param {string} [o.csrf]     CSRF トークン（ログアウトフォーム用）
 * @param {string} [o.active]   タブバーのアクティブ項目 'home' | 'history' | 'admin'
 * @param {object} o.body       html`` で生成した本文ノード
 * @param {string} [o.appName]  アプリ名
 */
export function layout({ title, user, csrf, active, body, appName = "民泊清掃" }) {
  const tabs = user
    ? html`
        <nav class="tabbar">
          <a href="/" class="${active === "home" ? "on" : ""}">清掃</a>
          <a href="/history" class="${active === "history" ? "on" : ""}">履歴</a>
          ${user.role === "admin"
            ? html`<a href="/admin" class="${active === "admin" ? "on" : ""}">管理</a>`
            : raw("")}
        </nav>
      `
    : raw("");

  const header = html`
    <header class="appbar">
      <span class="brand">${appName}</span>
      ${user
        ? html`<span class="who">${user.name}
            <form method="post" action="/logout" class="inline">
              ${csrf ? html`<input type="hidden" name="_csrf" value="${csrf}">` : raw("")}
              <button class="linklike" type="submit">ログアウト</button>
            </form>
          </span>`
        : raw("")}
    </header>
  `;

  return raw(`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2f6f4f">
<title>${render(html`${title}`)} · ${render(html`${appName}`)}</title>
<link rel="stylesheet" href="/app.css">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${render(html`${appName}`)}">
</head>
<body>
${render(header)}
<main class="wrap">
${render(body)}
</main>
${render(tabs)}
<script src="/app.js" type="module"></script>
</body>
</html>`);
}

/**
 * Response を作るショートカット。
 * c.html() を使うことで、事前に setCookie 等で設定したヘッダを保持する。
 */
export function page(c, opts, status = 200) {
  return c.html(render(layout(opts)), status);
}

/** ログイン済みページ用: user/csrf/appName を context から補完 */
export function authedPage(c, opts, status = 200) {
  return page(
    c,
    { ...opts, user: c.get("user"), csrf: c.get("csrf"), appName: c.env.APP_NAME },
    status,
  );
}
