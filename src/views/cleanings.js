import { html, raw } from "../lib/html.js";
import { authedPage } from "./layout.js";
import { fmtDateJst, fmtDateTimeJst, todayJst } from "../lib/datetime.js";
import { groupByArea } from "../lib/checklist.js";

function csrf(c) {
  return html`<input type="hidden" name="_csrf" value="${c.get("csrf")}" />`;
}

const STATUS_LABEL = {
  pending: "未着手",
  in_progress: "作業中",
  done: "完了",
  cancelled: "キャンセル",
};

function flash(msg) {
  return msg ? html`<div class="card ok-note">${msg}</div>` : raw("");
}

function progress(c) {
  const total = c.total || 0;
  const done = c.done || 0;
  return total ? html`<span class="cprog">${done}/${total}</span>` : raw("");
}

function cleaningCard(c, today) {
  const overdue = c.status !== "done" && c.clean_date < today;
  const who =
    c.status === "done"
      ? c.completed_by_name
      : c.status === "in_progress"
        ? c.started_by_name
        : null;
  return html`
    <a class="ccard status-${c.status} ${overdue ? "overdue" : ""}" href="/cleanings/${c.id}">
      <div class="ccard-row">
        <span class="cdate">${fmtDateJst(c.clean_date)}</span>
        <span class="badge status-${c.status}">${STATUS_LABEL[c.status]}</span>
      </div>
      <div class="ccard-row">
        <span class="cprop">${c.property_name}</span>
        ${progress(c)}
      </div>
      ${who ? html`<div class="ccard-row muted sm">担当: ${who}</div>` : raw("")}
      ${overdue ? html`<div class="ccard-row sm" style="color:var(--orange)">期限切れ</div>` : raw("")}
    </a>
  `;
}

// ─────────────────────────────────────────────
// S-02 ダッシュボード
// ─────────────────────────────────────────────
export function dashboardPage(c, { upcoming, recent, properties, selected, msg }) {
  const today = todayJst();
  return authedPage(c, {
    title: "清掃",
    active: "home",
    body: html`
      <h1>清掃予定</h1>
      ${flash(msg)}

      ${properties.length > 1
        ? html`
            <form method="get" action="/" class="card filter">
              <label class="fld">
                物件で絞り込み
                <select name="property" onchange="this.form.submit()">
                  <option value="">すべての物件</option>
                  ${properties.map(
                    (p) => html`
                      <option value="${p.id}" ${String(selected) === String(p.id) ? "selected" : ""}>
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

      <p><a class="btn secondary" href="/cleanings/new">臨時清掃を追加</a></p>

      <h2 class="sub">今後の清掃</h2>
      ${upcoming.length === 0
        ? html`<div class="card muted">直近の清掃予定はありません。</div>`
        : html`<div class="clist">${upcoming.map((x) => cleaningCard(x, today))}</div>`}

      <h2 class="sub">最近完了した清掃</h2>
      ${recent.length === 0
        ? html`<div class="card muted">最近完了した清掃はありません。</div>`
        : html`<div class="clist">${recent.map((x) => cleaningCard(x, today))}</div>`}
    `,
  });
}

// ─────────────────────────────────────────────
// S-03 清掃詳細
// ─────────────────────────────────────────────
export function cleaningDetailPage(c, { cleaning: cl, items, msg }) {
  const areas = groupByArea(items);
  const total = items.length;
  const doneN = items.filter((i) => i.checked).length;

  return authedPage(c, {
    title: cl.property_name,
    active: "home",
    body: html`
      <p><a href="/">&larr; 清掃一覧</a></p>
      <h1>${cl.property_name}</h1>
      ${flash(msg)}

      <div class="card">
        <div class="detail-line">
          <strong>${fmtDateJst(cl.clean_date)}</strong>
          <span class="muted">・午後実施（チェックアウト ${cl.checkout_time}）</span>
        </div>
        <div class="detail-line">
          <span class="badge status-${cl.status}">${STATUS_LABEL[cl.status]}</span>
          <span class="muted sm">
            ${cl.source === "manual" ? "臨時清掃" : "iCal 予約"}
            ${cl.guest_hint ? html`（下4桁 ${cl.guest_hint}）` : raw("")}
          </span>
        </div>
        ${cl.started_by_name
          ? html`<div class="detail-line muted sm">開始: ${cl.started_by_name} ${fmtDateTimeJst(cl.started_at)}</div>`
          : raw("")}
        ${cl.completed_by_name
          ? html`<div class="detail-line muted sm">完了: ${cl.completed_by_name} ${fmtDateTimeJst(cl.completed_at)}</div>`
          : raw("")}
      </div>

      ${statusActions(c, cl)}

      <form method="post" action="/cleanings/${cl.id}/note" class="card form">
        ${csrf(c)}
        <label class="fld">
          メモ（引き継ぎ・気づき）
          <textarea name="note" rows="3" maxlength="2000">${cl.note || ""}</textarea>
        </label>
        <button type="submit" class="secondary">メモを保存</button>
      </form>

      <h2 class="sub">チェックリスト ${total ? html`<span class="muted sm">${doneN}/${total}</span>` : raw("")}</h2>
      ${total === 0
        ? html`<div class="card muted">この清掃にはチェック項目がありません（物件にテンプレート未割当）。</div>`
        : areas.map(
            (a) => html`
              <div class="card area">
                <h3>
                  ${a.label}
                  <span class="muted sm">
                    ${a.items.filter((i) => i.checked).length}/${a.items.length}
                  </span>
                </h3>
                <ul class="items ro">
                  ${a.items.map(
                    (it) => html`
                      <li class="${it.checked ? "on" : ""}">
                        <span class="mark">${it.checked ? "✓" : "○"}</span>
                        <span class="lbl">${it.label}</span>
                        ${it.needs_photo ? html`<span class="badge photo">写真必須</span>` : raw("")}
                      </li>
                    `,
                  )}
                </ul>
              </div>
            `,
          )}
      ${total ? html`<p class="muted sm">※ チェック操作は P5、写真は P6 で追加します。</p>` : raw("")}
    `,
  });
}

function statusActions(c, cl) {
  if (cl.status === "cancelled") {
    return html`<div class="card err">この清掃はキャンセルされています（予約が取り消されました）。</div>`;
  }
  if (cl.status === "pending") {
    return html`
      <form method="post" action="/cleanings/${cl.id}/start" class="card">
        ${csrf(c)}
        <button type="submit">清掃を開始</button>
      </form>
    `;
  }
  if (cl.status === "in_progress") {
    return html`
      <form method="post" action="/cleanings/${cl.id}/complete" class="card">
        ${csrf(c)}
        <button type="submit">完了にする</button>
      </form>
    `;
  }
  // done
  return html`
    <form method="post" action="/cleanings/${cl.id}/reopen" class="card"
          onsubmit="return confirm('この清掃を作業中に戻しますか？')">
      ${csrf(c)}
      <p class="muted sm">誤って完了にした場合は作業中に戻せます。</p>
      <button type="submit" class="secondary">再オープン</button>
    </form>
  `;
}

// ─────────────────────────────────────────────
// S-12 臨時清掃の追加
// ─────────────────────────────────────────────
export function newCleaningPage(c, { properties, values = {}, err }) {
  return authedPage(c, {
    title: "臨時清掃の追加",
    active: "home",
    body: html`
      <p><a href="/">&larr; 清掃一覧</a></p>
      <h1>臨時清掃を追加</h1>
      ${err ? html`<div class="card err">${err}</div>` : raw("")}
      ${properties.length === 0
        ? html`<div class="card muted">有効な物件がありません。先に物件を登録してください。</div>`
        : html`
            <form method="post" action="/cleanings/new" class="card form">
              ${csrf(c)}
              <label class="fld">
                物件
                <select name="property_id" required>
                  ${properties.map(
                    (p) => html`
                      <option value="${p.id}" ${String(values.property_id) === String(p.id) ? "selected" : ""}>
                        ${p.name}
                      </option>
                    `,
                  )}
                </select>
              </label>
              <label class="fld">
                清掃日
                <input type="date" name="clean_date" value="${values.clean_date || todayJst()}" required />
              </label>
              <button type="submit">追加する</button>
            </form>
          `}
    `,
  });
}
