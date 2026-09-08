import { html, raw } from "../lib/html.js";
import { page } from "./layout.js";

/** ログイン画面 */
export function loginPage(c, { users = [], csrf, next = "", error = "" }, status = 200) {
  return page(
    c,
    {
      title: "ログイン",
      appName: c.env.APP_NAME,
      body: html`
        <h1>ログイン</h1>
        ${error ? html`<div class="card err">${error}</div>` : raw("")}
        <form method="post" action="/login" class="card form">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="next" value="${next}" />
          <fieldset class="userpick">
            <legend>名前</legend>
            ${users.map(
              (u, i) => html`
                <label class="pick">
                  <input
                    type="radio"
                    name="user_id"
                    value="${u.id}"
                    ${i === 0 ? "checked" : ""}
                  />
                  <span>${u.name}</span>
                </label>
              `,
            )}
          </fieldset>
          <label class="fld">
            PIN
            <input
              type="password"
              name="pin"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              required
            />
          </label>
          <button type="submit">ログイン</button>
        </form>
        <p class="muted sm">
          アカウントがない場合は、管理者から登録用リンクを受け取ってください
          （管理者は「管理 &gt; ユーザー管理」で確認できます）。
        </p>
      `,
    },
    status,
  );
}

/** ユーザー登録画面 */
export function registerPage(
  c,
  { token = "", csrf, closed = false, error = "", name = "" },
  status = 200,
) {
  return page(
    c,
    {
      title: "ユーザー登録",
      appName: c.env.APP_NAME,
      body: closed
        ? html`
            <h1>ユーザー登録</h1>
            <div class="card">現在、新規登録は受け付けていません。</div>
          `
        : html`
            <h1>ユーザー登録</h1>
            <p class="muted">表示名と PIN を設定します。PIN はログインに使います。</p>
            ${error ? html`<div class="card err">${error}</div>` : raw("")}
            <form method="post" action="/register" class="card form">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="token" value="${token}" />
              <label class="fld">
                表示名（1〜20文字）
                <input type="text" name="name" value="${name}" maxlength="20" required />
              </label>
              <label class="fld">
                PIN（4〜6桁の数字）
                <input
                  type="password"
                  name="pin"
                  inputmode="numeric"
                  pattern="[0-9]{4,6}"
                  minlength="4"
                  maxlength="6"
                  autocomplete="off"
                  required
                />
              </label>
              <label class="fld">
                PIN（確認）
                <input
                  type="password"
                  name="pin2"
                  inputmode="numeric"
                  pattern="[0-9]{4,6}"
                  minlength="4"
                  maxlength="6"
                  autocomplete="off"
                  required
                />
              </label>
              <button type="submit">登録する</button>
            </form>
          `,
    },
    status,
  );
}
