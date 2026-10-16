import { html, raw } from "../lib/html.js";
import { authedPage } from "./layout.js";
import { fmtDateTimeJst } from "../lib/datetime.js";

function csrf(c) {
  return html`<input type="hidden" name="_csrf" value="${c.get("csrf")}" />`;
}

function flash(msg) {
  return msg ? html`<div class="card ok-note">${msg}</div>` : raw("");
}

export function shortagesPage(c, { properties, selectedPropertyId, items, isAdmin, msg }) {
  const selectedProperty = properties.find((p) => p.id === selectedPropertyId);
  const open = items.filter((i) => i.status === "open");
  const done = items.filter((i) => i.status === "done");
  return authedPage(c, {
    title: selectedProperty ? `${selectedProperty.name}の不足・破損` : "不足・破損",
    active: "shortages",
    body: html`
      <h1>${selectedProperty ? html`${selectedProperty.name}の不足・破損` : "不足・破損"}</h1>
      ${flash(msg)}

      ${properties.length === 0
        ? html`<div class="card muted">有効な物件がありません。先に物件を登録してください。</div>`
        : html`
            ${properties.length > 1
              ? html`
                  <form method="get" action="/shortages" class="card filter">
                    <label class="fld">
                      物件
                      <select name="property" onchange="this.form.submit()">
                        ${properties.map(
                          (p) => html`
                            <option value="${p.id}" ${selectedPropertyId === p.id ? "selected" : ""}>
                              ${p.name}
                            </option>
                          `,
                        )}
                      </select>
                    </label>
                    <noscript><button type="submit">絞り込む</button></noscript>
                  </form>
                `
              : raw("")}

            <h2 class="sub" style="margin-top:0">未対応 <span class="muted sm">${open.length}件</span></h2>
            ${open.length
              ? html`<div class="shortage-list">${open.map((it) => shortageRow(c, it, isAdmin))}</div>`
              : html`<div class="card muted">未対応の不足備品はありません。</div>`}

            ${done.length
              ? html`
                  <h2 class="sub">対応済み <span class="muted sm">${done.length}件</span></h2>
                  <div class="shortage-list">${done.map((it) => shortageRow(c, it, isAdmin))}</div>
                `
              : raw("")}
          `}
    `,
  });
}

function photoThumbs(c, it) {
  const me = c.get("user");
  return html`
    ${it.photos.length
      ? html`
          <div class="photos photos-sm shortage-photos">
            ${it.photos.map(
              (p) => html`
                <div class="shortage-photo">
                  <a class="thumb" href="/shortages/photos/${p.id}?view=1">
                    <img src="/shortages/photos/${p.id}?thumb=1&v=${encodeURIComponent(p.uploaded_at)}" alt="写真" loading="lazy" />
                  </a>
                  ${p.uploaded_by === me.id || me.role === "admin"
                    ? html`
                        <form method="post" action="/shortages/photos/${p.id}/delete" class="shortage-photo-del"
                              onsubmit="return confirm('この写真を削除しますか？')">
                          ${csrf(c)}
                          <button type="submit" class="linkbtn danger sm">削除</button>
                        </form>
                      `
                    : raw("")}
                </div>
              `,
            )}
          </div>
        `
      : raw("")}
    <form method="post" action="/shortages/${it.id}/photos" enctype="multipart/form-data" class="photo-form shortage-upload">
      ${csrf(c)}
      <label class="photo-btn">
        <input type="file" name="full" accept="image/*" multiple />
        <span>📷 写真を追加（複数可）</span>
      </label>
      <noscript><button type="submit" class="secondary sm">アップロード</button></noscript>
    </form>
  `;
}

// 内容・種類の修正は登録者本人と admin
function canEdit(c, it) {
  const me = c.get("user");
  return me.role === "admin" || it.created_by === me.id;
}

function shortageRow(c, it, isAdmin) {
  const isDone = it.status === "done";
  const isDamage = it.kind === "damage";
  return html`
    <div class="card shortage-row ${isDone ? "is-done" : ""}">
      <div class="shortage-head">
        <span class="shortage-body">
          <span class="kind-badge ${isDamage ? "kind-damage" : "kind-shortage"}">${isDamage ? "破損" : "不足"}</span>
          ${it.body}
        </span>
        ${isAdmin
          ? html`
              <form method="post" action="/shortages/${it.id}/${isDone ? "reopen" : "done"}" class="shortage-ops">
                ${csrf(c)}
                <button type="submit" class="${isDone ? "secondary" : ""} sm">${isDone ? "未対応に戻す" : "対応済み"}</button>
              </form>
            `
          : raw("")}
      </div>
      <p class="muted sm">
        登録: ${it.created_by_name} ${fmtDateTimeJst(it.created_at)}
        ${isDone ? html`・対応: ${it.done_by_name || "?"} ${fmtDateTimeJst(it.done_at)}` : raw("")}
      </p>
      ${photoThumbs(c, it)}
      ${canEdit(c, it)
        ? html`
            <details class="shortage-edit">
              <summary class="muted sm">内容・種類を修正</summary>
              <form method="post" action="/shortages/${it.id}/edit" class="form sub-form">
                ${csrf(c)}
                <fieldset class="kind-pick">
                  <legend class="muted sm">種類</legend>
                  <label><input type="radio" name="kind" value="shortage" ${isDamage ? "" : "checked"} /> 不足（購入を依頼）</label>
                  <label><input type="radio" name="kind" value="damage" ${isDamage ? "checked" : ""} /> 破損（報告）</label>
                </fieldset>
                <label class="fld">
                  内容
                  <input type="text" name="body" value="${it.body}" maxlength="200" required />
                </label>
                <button type="submit" class="secondary sm">保存</button>
              </form>
            </details>
          `
        : raw("")}
      ${isAdmin
        ? html`
            <form method="post" action="/shortages/${it.id}/delete" class="shortage-del"
                  onsubmit="return confirm('この不足備品を削除しますか？')">
              ${csrf(c)}
              <button type="submit" class="linkbtn danger">削除</button>
            </form>
          `
        : raw("")}
    </div>
  `;
}
