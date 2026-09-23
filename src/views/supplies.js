import { html, raw } from "../lib/html.js";
import { authedPage } from "./layout.js";
import { fmtDateTimeJst } from "../lib/datetime.js";

function csrf(c) {
  return html`<input type="hidden" name="_csrf" value="${c.get("csrf")}" />`;
}

function flash(msg) {
  return msg ? html`<div class="card ok-note">${msg}</div>` : raw("");
}

export function suppliesPage(c, { properties, selectedPropertyId, items, isAdmin, msg }) {
  const selectedProperty = properties.find((p) => p.id === selectedPropertyId);
  return authedPage(c, {
    title: selectedProperty ? `${selectedProperty.name}の備品` : "備品",
    active: "supplies",
    body: html`
      <h1>${selectedProperty ? html`${selectedProperty.name}の備品` : "備品"}</h1>
      ${flash(msg)}

      ${properties.length === 0
        ? html`<div class="card muted">有効な物件がありません。先に物件を登録してください。</div>`
        : html`
            ${properties.length > 1
              ? html`
                  <form method="get" action="/supplies" class="card filter">
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

            ${items.length === 0
              ? html`<div class="card muted">まだ備品が登録されていません。</div>`
              : html`<div class="supply-list">${items.map((it) => supplyRow(c, it, isAdmin))}</div>`}

            ${isAdmin ? addSupplyForm(c, selectedPropertyId) : raw("")}
          `}
    `,
  });
}

function supplyRow(c, it, isAdmin) {
  return html`
    <div class="card supply-row">
      <div class="supply-head">
        <span class="supply-name">
          ${it.name}
          ${it.unit ? html`<span class="muted sm">（${it.unit}）</span>` : raw("")}
        </span>
        ${isAdmin
          ? html`
              <form method="post" action="/supplies/${it.id}/move" class="supply-ops">
                ${csrf(c)}
                <button type="submit" name="dir" value="up" class="linkbtn">↑</button>
                <button type="submit" name="dir" value="down" class="linkbtn">↓</button>
                <button type="submit" formaction="/supplies/${it.id}/delete" class="linkbtn danger"
                  onclick="return confirm('この備品を削除しますか？（履歴も削除されます）')">✕</button>
              </form>
            `
          : raw("")}
      </div>

      <form method="post" action="/supplies/${it.id}/stock" class="supply-stock-form">
        ${csrf(c)}
        <input type="number" name="stock" min="0" step="1" value="${it.stock}" required />
        <input type="text" name="note" maxlength="200" placeholder="備考（任意）" />
        <button type="submit" class="secondary sm">更新</button>
      </form>

      <p class="muted sm">
        ${it.note ? html`備考: ${it.note}・` : raw("")}
        ${it.updated_at
          ? html`最終更新: ${it.updated_by_name ? `${it.updated_by_name} ` : ""}${fmtDateTimeJst(it.updated_at)}`
          : "更新履歴なし"}
      </p>

      ${isAdmin
        ? html`
            <details class="supply-edit">
              <summary class="muted sm">名前・単位を編集</summary>
              <form method="post" action="/supplies/${it.id}" class="form sub-form">
                ${csrf(c)}
                <label class="fld">
                  備品名
                  <input type="text" name="name" value="${it.name}" maxlength="60" required />
                </label>
                <label class="fld">
                  単位（任意）
                  <input type="text" name="unit" value="${it.unit || ""}" maxlength="20" placeholder="例: 本・個・L" />
                </label>
                <button type="submit" class="secondary sm">保存</button>
              </form>
            </details>
          `
        : raw("")}
    </div>
  `;
}

function addSupplyForm(c, propertyId) {
  return html`
    <div class="card form">
      <h2 class="sub" style="margin-top:0">備品を追加</h2>
      <form method="post" action="/supplies" class="form sub-form">
        ${csrf(c)}
        <input type="hidden" name="property_id" value="${propertyId || ""}" />
        <label class="fld">
          備品名
          <input type="text" name="name" maxlength="60" placeholder="例: トイレットペーパー" required />
        </label>
        <label class="fld">
          単位（任意）
          <input type="text" name="unit" maxlength="20" placeholder="例: 本・個・L" />
        </label>
        <label class="fld">
          初期在庫数
          <input type="number" name="stock" min="0" step="1" value="0" />
        </label>
        <button type="submit">追加する</button>
      </form>
    </div>
  `;
}
