import { html, raw } from "../lib/html.js";
import { authedPage } from "./layout.js";
import { fmtDateJst, fmtDateTimeJst, todayJst } from "../lib/datetime.js";
import { groupByArea } from "../lib/checklist.js";
import { workDurationMs, fmtDuration } from "../lib/events.js";

const EVENT_LABEL = {
  start: "開始",
  complete: "完了",
  reopen: "作業中に戻す",
  note: "メモ更新",
  check: "チェック",
  uncheck: "チェック解除",
  photo_add: "写真追加",
  photo_delete: "写真削除",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

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
  const elapsed =
    c.status === "done" && c.started_at && c.completed_at
      ? fmtDuration(Math.max(0, Date.parse(c.completed_at) - Date.parse(c.started_at)))
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
      ${who || elapsed
        ? html`<div class="ccard-row muted sm">
            ${who ? html`担当: ${who}` : raw("")}
            ${elapsed ? html`<span>所要 ${elapsed}</span>` : raw("")}
          </div>`
        : raw("")}
      ${overdue ? html`<div class="ccard-row sm" style="color:var(--orange)">期限切れ</div>` : raw("")}
    </a>
  `;
}

// ─────────────────────────────────────────────
// S-02 ダッシュボード（月カレンダー）
// ─────────────────────────────────────────────
export function dashboardPage(c, opts) {
  const {
    today,
    month,
    prevMonth,
    nextMonth,
    weeks,
    byDate,
    selectedDay,
    dayCleanings,
    overdue,
    properties,
    selectedProperty,
    msg,
  } = opts;
  const [y, m] = month.split("-");
  const pq = selectedProperty ? `&property=${selectedProperty}` : "";

  // その日の状態内訳（ドット用）
  const marksFor = (date) => {
    const list = byDate[date] || [];
    return {
      count: list.length,
      pending: list.some((x) => x.status === "pending"),
      in_progress: list.some((x) => x.status === "in_progress"),
      done: list.every((x) => x.status === "done") && list.length > 0,
      anyDone: list.some((x) => x.status === "done"),
    };
  };

  return authedPage(c, {
    title: "清掃",
    active: "home",
    body: html`
      <h1>清掃カレンダー</h1>
      ${flash(msg)}

      ${overdue
        ? html`
            <a class="card overdue-banner"
               href="/?month=${overdue.first.slice(0, 7)}&day=${overdue.first}${pq}">
              期限切れの未完了清掃が ${overdue.count} 件あります &rsaquo;
            </a>
          `
        : raw("")}

      ${properties.length > 1
        ? html`
            <form method="get" action="/" class="card filter">
              <input type="hidden" name="month" value="${month}" />
              <label class="fld">
                物件で絞り込み
                <select name="property" onchange="this.form.submit()">
                  <option value="">すべての物件</option>
                  ${properties.map(
                    (p) => html`
                      <option value="${p.id}" ${selectedProperty === String(p.id) ? "selected" : ""}>
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

      <div class="cal">
        <div class="cal-nav">
          <a class="cal-arrow" href="/?month=${prevMonth}${pq}" aria-label="前の月">&lsaquo;</a>
          <span class="cal-title">${y}年${Number(m)}月</span>
          <a class="cal-arrow" href="/?month=${nextMonth}${pq}" aria-label="次の月">&rsaquo;</a>
        </div>
        <div class="cal-grid cal-dow">
          ${WEEKDAYS.map((w, i) => html`<div class="dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</div>`)}
        </div>
        ${weeks.map(
          (week) => html`
            <div class="cal-grid">
              ${week.map((cell) => {
                if (!cell) return html`<div class="cal-cell empty"></div>`;
                const mk = marksFor(cell.date);
                const cls = [
                  "cal-cell",
                  cell.date === today ? "today" : "",
                  cell.date === selectedDay ? "sel" : "",
                  mk.count ? "has" : "",
                ].join(" ");
                return html`
                  <a class="${cls}" href="/?month=${month}&day=${cell.date}${pq}">
                    <span class="cal-num">${cell.day}</span>
                    ${mk.count
                      ? html`
                          <span class="cal-dots">
                            ${mk.pending ? html`<i class="dot status-pending"></i>` : raw("")}
                            ${mk.in_progress ? html`<i class="dot status-in_progress"></i>` : raw("")}
                            ${mk.anyDone ? html`<i class="dot status-done"></i>` : raw("")}
                          </span>
                          <span class="cal-n">${mk.count}</span>
                        `
                      : raw("")}
                  </a>
                `;
              })}
            </div>
          `,
        )}
      </div>

      <h2 class="sub">${fmtDateJst(selectedDay)} の清掃</h2>
      ${dayCleanings.length === 0
        ? html`<div class="card muted">この日の清掃はありません。</div>`
        : html`<div class="clist">${dayCleanings.map((x) => cleaningCard(x, today))}</div>`}

      <p><a class="btn secondary" href="/cleanings/new">臨時清掃を追加</a></p>
    `,
  });
}

// ─────────────────────────────────────────────
// S-03 清掃詳細
// ─────────────────────────────────────────────
export function cleaningDetailPage(c, { cleaning: cl, items, events = [], photos = [], msg }) {
  const areas = groupByArea(items);
  const total = items.length;
  const doneN = items.filter((i) => i.checked).length;
  const incomplete = total - doneN;
  const editable = cl.status !== "cancelled";
  const isAdmin = c.get("user").role === "admin";
  const hasStarted = events.some((e) => e.kind === "start");
  const durationMs = workDurationMs(events);
  const running = cl.status === "in_progress";

  const photosByItem = new Map();
  const cleaningPhotos = [];
  for (const p of photos) {
    if (p.checklist_item_id) {
      if (!photosByItem.has(p.checklist_item_id)) photosByItem.set(p.checklist_item_id, []);
      photosByItem.get(p.checklist_item_id).push(p);
    } else {
      cleaningPhotos.push(p);
    }
  }

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
        ${hasStarted
          ? html`<div class="detail-line">
              <strong>実作業時間: ${fmtDuration(durationMs)}</strong>
              ${running ? html`<span class="muted sm">（作業中・経過）</span>` : raw("")}
            </div>`
          : raw("")}
      </div>

      ${statusActions(c, cl, incomplete)}

      <form method="post" action="/cleanings/${cl.id}/note" class="card form">
        ${csrf(c)}
        <label class="fld">
          メモ（引き継ぎ・気づき）
          <textarea name="note" rows="3" maxlength="2000">${cl.note || ""}</textarea>
        </label>
        <button type="submit" class="secondary">メモを保存</button>
      </form>

      <h2 class="sub">
        チェックリスト
        ${total ? html`<span class="muted sm" data-overall>${doneN}/${total}</span>` : raw("")}
      </h2>
      ${total === 0
        ? html`<div class="card muted">この清掃にはチェック項目がありません（物件にテンプレート未割当）。</div>`
        : areas.map(
            (a) => html`
              <div class="card area">
                <h3>
                  ${a.label}
                  <span class="muted sm" data-area-prog="${a.label}">
                    ${a.items.filter((i) => i.checked).length}/${a.items.length}
                  </span>
                </h3>
                <ul class="items">
                  ${a.items.map((it) =>
                    checkItem(c, cl, it, editable, photosByItem.get(it.id) || []),
                  )}
                </ul>
              </div>
            `,
          )}
      ${total && !editable
        ? html`<p class="muted sm">キャンセル済みのためチェックは変更できません。</p>`
        : raw("")}

      <h2 class="sub">写真 <span class="muted sm">${photos.length}枚</span></h2>
      <div class="card">
        ${cleaningPhotos.length
          ? photoStrip(cleaningPhotos)
          : html`<p class="muted sm">清掃全体の写真はまだありません。</p>`}
        ${editable ? uploadWidget(c, cl.id, null) : raw("")}
      </div>

      ${events.length
        ? html`
            <h2 class="sub">作業記録</h2>
            <div class="card">
              <ul class="timeline">
                ${events.map(
                  (e) => html`
                    <li>
                      <span class="tl-at">${fmtDateTimeJst(e.at)}</span>
                      <span class="tl-kind">${EVENT_LABEL[e.kind] || e.kind}</span>
                      ${e.detail ? html`<span class="tl-detail">${e.detail}</span>` : raw("")}
                      ${e.user_name ? html`<span class="tl-who muted sm">${e.user_name}</span>` : raw("")}
                    </li>
                  `,
                )}
              </ul>
            </div>
          `
        : raw("")}

      ${isAdmin
        ? html`
            <form method="post" action="/cleanings/${cl.id}/delete" class="card"
                  onsubmit="return confirm('この清掃を削除します。よろしいですか？')">
              ${csrf(c)}
              <p class="muted sm">
                この清掃を削除します（チェック状態・写真も消えます）。
                ${cl.source === "manual"
                  ? raw("")
                  : "iCal 予約由来のため、次回の同期で現在のテンプレートを使って作り直されます。"}
              </p>
              <button type="submit" class="secondary danger">この清掃を削除</button>
            </form>
          `
        : raw("")}
    `,
  });
}

function checkItem(c, cl, it, editable, itemPhotos = []) {
  const inner = html`
    <span class="mark">${it.checked ? "✓" : "○"}</span>
    <span class="lbl">${it.label}</span>
    ${it.needs_photo ? html`<span class="badge photo">写真</span>` : raw("")}
    ${it.checked && it.checked_by_name
      ? html`<span class="by muted sm">${it.checked_by_name}</span>`
      : raw("")}
  `;
  const media =
    itemPhotos.length || editable
      ? html`
          <div class="item-media">
            ${itemPhotos.length ? photoStrip(itemPhotos) : raw("")}
            ${editable ? uploadWidget(c, cl.id, it.id) : raw("")}
          </div>
        `
      : raw("");

  if (!editable) {
    return html`<li class="ro ${it.checked ? "on" : ""}" data-area="${it.area_label}">
      ${inner}${media}
    </li>`;
  }
  return html`
    <li class="${it.checked ? "on" : ""}" data-area="${it.area_label}">
      <form method="post" action="/cleanings/${cl.id}/items/${it.id}/toggle" class="chk-form">
        ${csrf(c)}
        <button type="submit" class="chk-row" aria-pressed="${it.checked ? "true" : "false"}">
          ${inner}
        </button>
      </form>
      ${media}
    </li>
  `;
}

function photoStrip(list) {
  return html`
    <div class="photos">
      ${list.map(
        (p) => html`
          <a class="thumb" href="/photos/${p.id}?view=1">
            <img src="/photos/${p.id}?thumb=1" alt="${p.caption || "写真"}" loading="lazy" />
          </a>
        `,
      )}
    </div>
  `;
}

function uploadWidget(c, cleaningId, itemId) {
  return html`
    <form
      class="photo-form"
      method="post"
      action="/cleanings/${cleaningId}/photos"
      enctype="multipart/form-data"
      data-cleaning="${cleaningId}"
      ${itemId ? html`data-item="${itemId}"` : raw("")}
    >
      ${csrf(c)}
      ${itemId ? html`<input type="hidden" name="item_id" value="${itemId}" />` : raw("")}
      <label class="photo-btn">
        <input type="file" name="full" accept="image/*" />
        <span>＋ 写真を追加</span>
      </label>
      <noscript><button type="submit" class="secondary sm">アップロード</button></noscript>
    </form>
  `;
}

function statusActions(c, cl, incomplete = 0) {
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
      <form method="post" action="/cleanings/${cl.id}/complete" class="card" data-complete-form
            data-incomplete="${incomplete}">
        ${csrf(c)}
        ${incomplete > 0
          ? html`<p class="muted sm" data-incomplete-note>未チェックの項目が ${incomplete} 件あります。</p>`
          : raw("")}
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
