import { html, raw } from "../lib/html.js";
import { authedPage } from "./layout.js";
import { fmtDateJst } from "../lib/datetime.js";
import { fmtDuration } from "../lib/events.js";

export function historyPage(c, { rows, properties, filter }) {
  const qp = new URLSearchParams();
  if (filter.propId) qp.set("property", String(filter.propId));
  qp.set("from", filter.from);
  qp.set("to", filter.to);
  const qs = qp.toString();

  return authedPage(c, {
    title: "履歴",
    active: "history",
    body: html`
      <h1>清掃履歴</h1>

      <form method="get" action="/history" class="card form filter-form">
        <div class="filter-grid">
          <label class="fld">
            物件
            <select name="property">
              <option value="">すべて</option>
              ${properties.map(
                (p) => html`
                  <option value="${p.id}" ${String(filter.propId) === String(p.id) ? "selected" : ""}>
                    ${p.name}
                  </option>
                `,
              )}
            </select>
          </label>
          <label class="fld">
            期間（開始）
            <input type="date" name="from" value="${filter.from}" />
          </label>
          <label class="fld">
            期間（終了）
            <input type="date" name="to" value="${filter.to}" />
          </label>
        </div>
        <button type="submit">絞り込む</button>
      </form>

      <p class="muted sm">
        ${rows.length} 件
        ${rows.length >= 500 ? "（上限500件・期間を絞ってください）" : ""}
        ・
        <a href="/history/export.csv?${qs}">CSV</a> /
        <a href="/history/export.json?${qs}">JSON</a> でエクスポート
      </p>

      ${rows.length === 0
        ? html`<div class="card muted">この条件の履歴はありません。</div>`
        : html`
            <div class="clist">
              ${rows.map(
                (r) => html`
                  <a class="ccard status-${r.status}" href="/cleanings/${r.id}">
                    <div class="ccard-row">
                      <span class="cdate">${fmtDateJst(r.clean_date)}</span>
                      <span class="badge status-${r.status}">
                        ${r.status === "done" ? "完了" : "キャンセル"}
                      </span>
                    </div>
                    <div class="ccard-row">
                      <span class="cprop">${r.property_name}</span>
                      ${r.status === "done"
                        ? html`<span class="cprog">${fmtDuration(r.duration_ms || 0)}</span>`
                        : raw("")}
                    </div>
                    <div class="ccard-row muted sm">
                      ${r.completed_by_name ? html`担当: ${r.completed_by_name}` : raw("")}
                      ${r.photo_count ? html`<span>写真 ${r.photo_count}枚</span>` : raw("")}
                      ${r.note ? html`<span>メモあり</span>` : raw("")}
                    </div>
                  </a>
                `,
              )}
            </div>
          `}
    `,
  });
}
