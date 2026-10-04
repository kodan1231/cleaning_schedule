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
    title: selectedProperty ? `${selectedProperty.name}の不足備品` : "不足備品",
    active: "shortages",
    body: html`
      <h1>${selectedProperty ? html`${selectedProperty.name}の不足備品` : "不足備品"}</h1>
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

function shortageRow(c, it, isAdmin) {
  const isDone = it.status === "done";
  return html`
    <div class="card shortage-row ${isDone ? "is-done" : ""}">
      <div class="shortage-head">
        <span class="shortage-body">${it.body}</span>
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
