import { html, raw } from "../lib/html.js";
import { authedPage } from "./layout.js";
import { fmtDateJst, fmtDateTimeJst, todayJst, daysBetween } from "../lib/datetime.js";
import { groupByRoom } from "../lib/checklist.js";
import { workDurationMs, fmtDuration } from "../lib/events.js";

const EVENT_LABEL = {
  start: "開始",
  complete: "完了",
  reopen: "作業中に戻す",
  note: "全体メモ更新",
  room_memo: "部屋メモ更新",
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

/** 予約由来なら「N泊」。取れなければ null */
function nightsLabel(c) {
  if (!c.checkin_date || !c.clean_date) return null;
  const n = daysBetween(c.checkin_date, c.clean_date);
  return n > 0 ? `${n}泊` : null;
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
  const nights = nightsLabel(c);
  return html`
    <a class="ccard status-${c.status} ${overdue ? "overdue" : ""}" href="/cleanings/${c.id}">
      <div class="ccard-row">
        <span class="cdate">${fmtDateJst(c.clean_date)}</span>
        <span class="badge status-${c.status}">${STATUS_LABEL[c.status]}</span>
      </div>
      <div class="ccard-row">
        <span class="cprop">${c.property_name}</span>
        <span>
          ${nights ? html`<span class="badge">${nights}</span>` : raw("")}
          ${progress(c)}
        </span>
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
    stayByDate = {},
    selectedDay,
    dayCleanings,
    dayStay,
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
                const st = stayByDate[cell.date];
                const cls = [
                  "cal-cell",
                  cell.date === today ? "today" : "",
                  cell.date === selectedDay ? "sel" : "",
                  mk.count ? "has" : "",
                  st && st.occupied ? "stay" : "",
                ].join(" ");
                return html`
                  <a class="${cls}" href="/?month=${month}&day=${cell.date}${pq}">
                    <span class="cal-num">${cell.day}</span>
                    ${st && st.checkins.length ? html`<span class="cal-in">IN</span>` : raw("")}
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

      <h2 class="sub">${fmtDateJst(selectedDay)}</h2>

      ${dayStay && (dayStay.checkins.length || dayStay.checkouts.length || dayStay.occupied)
        ? html`
            <div class="card stay-panel">
              <strong class="sm">宿泊</strong>
              ${dayStay.checkouts.map(
                (s) => html`<div class="sm">
                  ${s.property_name}: <span class="badge">OUT</span>
                  ${s.guest_hint ? html`下4桁 ${s.guest_hint}` : raw("")}
                  （${daysBetween(s.checkin_date, s.checkout_date)}泊・${fmtDateJst(s.checkin_date)} イン）
                </div>`,
              )}
              ${dayStay.checkins.map(
                (s) => html`<div class="sm">
                  ${s.property_name}: <span class="badge">IN</span>
                  ${s.guest_hint ? html`下4桁 ${s.guest_hint}` : raw("")}
                  （${daysBetween(s.checkin_date, s.checkout_date)}泊・${fmtDateJst(s.checkout_date)} アウト）
                </div>`,
              )}
              ${dayStay.occupied && !dayStay.checkins.length && !dayStay.checkouts.length
                ? html`<div class="sm muted">滞在中</div>`
                : raw("")}
            </div>
          `
        : raw("")}

      <div class="stay-label muted sm">この日の清掃</div>
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
export function cleaningDetailPage(
  c,
  { cleaning: cl, items, events = [], photos = [], roomPhotos = [], roomMemos = [], eventsQuery = {}, msg },
) {
  const rooms = groupByRoom(items);
  // 部屋名 → 部屋（引き継ぎメモ付き）。同名がある場合は sort_order が先のものを採用
  const roomByName = new Map();
  for (const r of roomMemos) if (!roomByName.has(r.name)) roomByName.set(r.name, r);
  const roomPhotosByName = new Map();
  for (const p of roomPhotos) {
    if (!roomPhotosByName.has(p.room_name)) roomPhotosByName.set(p.room_name, []);
    roomPhotosByName.get(p.room_name).push(p);
  }
  const total = items.length;
  const doneN = items.filter((i) => i.checked).length;
  const incomplete = total - doneN;
  const editable = cl.status !== "cancelled";
  const isAdmin = c.get("user").role === "admin";
  const hasStarted = events.some((e) => e.kind === "start");
  const durationMs = workDurationMs(events);
  const running = cl.status === "in_progress";

  const startPhotos = photos.filter((p) => p.kind === "start");
  const photosByItem = new Map();
  for (const p of photos) {
    if (p.kind === "start") continue;
    if (!p.checklist_item_id) continue;
    if (!photosByItem.has(p.checklist_item_id)) photosByItem.set(p.checklist_item_id, []);
    photosByItem.get(p.checklist_item_id).push(p);
  }
  // 下部の「写真」欄は従来どおりチェック項目の証跡写真のみ（掃除前の写真は専用セクションで表示）
  const photoGroups = groupPhotosByRoom(
    photos.filter((p) => p.kind !== "start"),
    items,
  );

  const showAllEvents = Boolean(eventsQuery.all || eventsQuery.user || eventsQuery.kind);
  const eventUsers = [...new Map(events.filter((e) => e.user_id).map((e) => [e.user_id, e.user_name])).entries()];
  let filteredEvents = events;
  if (eventsQuery.user) filteredEvents = filteredEvents.filter((e) => String(e.user_id) === eventsQuery.user);
  if (eventsQuery.kind) filteredEvents = filteredEvents.filter((e) => e.kind === eventsQuery.kind);
  const RECENT_EVENTS = 10;
  // events は実作業時間の計算（workDurationMs）のため古い順のまま保持し、表示用だけ新しい順に反転する
  const displayEvents = (showAllEvents ? filteredEvents : events.slice(-RECENT_EVENTS)).slice().reverse();

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
        ${cl.checkin_date && cl.checkout_date
          ? html`<div class="detail-line">
              宿泊: ${fmtDateJst(cl.checkin_date)} イン → ${fmtDateJst(cl.checkout_date)} アウト
              <span class="badge">${daysBetween(cl.checkin_date, cl.checkout_date)}泊</span>
            </div>`
          : raw("")}
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

      <form method="post" action="/cleanings/${cl.id}/note" class="card form">
        ${csrf(c)}
        <label class="fld">
          全体メモ（次回以降に引き継がれます）
          <textarea name="note" rows="3" maxlength="2000">${cl.property_memo || ""}</textarea>
        </label>
        <div class="room-memo-foot">
          <button type="submit" class="secondary">メモを保存</button>
          ${cl.property_memo && cl.property_memo_updated_at
            ? html`<span class="muted sm">
                最終更新: ${cl.property_memo_updated_by_name ? `${cl.property_memo_updated_by_name} ` : ""}${fmtDateTimeJst(cl.property_memo_updated_at)}
              </span>`
            : raw("")}
        </div>
      </form>

      ${statusActions(c, cl, incomplete)}
      ${startPhotoSection(c, cl, startPhotos, editable)}

      <h2 class="sub">
        チェックリスト
        ${total ? html`<span class="muted sm" data-overall>${doneN}/${total}</span>` : raw("")}
      </h2>
      ${total === 0
        ? html`<div class="card muted">
            この清掃にはチェック項目がありません（物件に間取り／テンプレート未設定）。
          </div>`
        : rooms.map((r) => roomBlock(c, cl, r, editable, photosByItem, roomPhotosByName, roomByName.get(r.name)))}
      ${total && !editable
        ? html`<p class="muted sm">キャンセル済みのためチェックは変更できません。</p>`
        : raw("")}

      <h2 class="sub">写真 <span class="muted sm">${photos.length - startPhotos.length}枚</span></h2>
      <div class="card">
        ${photoGroups.length
          ? photoGroups.map(
              (g) => html`
                <div class="photo-group">
                  <div class="muted sm">${g.name}</div>
                  ${photoStrip(g.photos)}
                </div>
              `,
            )
          : html`<p class="muted sm">写真はまだありません。</p>`}
        ${editable ? uploadWidget(c, cl.id, null) : raw("")}
      </div>

      ${events.length
        ? html`
            <h2 class="sub">作業記録</h2>
            ${showAllEvents
              ? html`
                  <form method="get" action="/cleanings/${cl.id}" class="card form filter-form">
                    <input type="hidden" name="events" value="all" />
                    <div class="filter-grid">
                      <label class="fld">
                        担当者
                        <select name="euser">
                          <option value="">すべて</option>
                          ${eventUsers.map(
                            ([uid, uname]) => html`
                              <option value="${uid}" ${String(eventsQuery.user) === String(uid) ? "selected" : ""}>
                                ${uname}
                              </option>
                            `,
                          )}
                        </select>
                      </label>
                      <label class="fld">
                        操作
                        <select name="ekind">
                          <option value="">すべて</option>
                          ${Object.entries(EVENT_LABEL).map(
                            ([kind, label]) => html`
                              <option value="${kind}" ${eventsQuery.kind === kind ? "selected" : ""}>${label}</option>
                            `,
                          )}
                        </select>
                      </label>
                    </div>
                    <button type="submit">絞り込む</button>
                  </form>
                `
              : raw("")}
            <div class="card">
              ${displayEvents.length
                ? html`
                    <ul class="timeline">
                      ${displayEvents.map(
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
                  `
                : html`<p class="muted sm">条件に一致する記録がありません。</p>`}
              ${showAllEvents
                ? html`<p class="muted sm"><a href="/cleanings/${cl.id}">直近${RECENT_EVENTS}件の表示に戻す</a></p>`
                : events.length > RECENT_EVENTS
                  ? html`<p class="muted sm">
                      <a href="/cleanings/${cl.id}?events=all">すべて表示（全${events.length}件）</a>
                    </p>`
                  : raw("")}
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

/**
 * 掃除前の写真。部屋を分けず、まとめて何枚でも撮る（一括管理）。
 * 撮った写真は photo.kind='start' で保存される（下部の「写真」欄には出さず、ここでまとめて表示）。
 */
function startPhotoSection(c, cl, startPhotos, editable) {
  return html`
    <div class="card">
      <h2 class="sub" style="margin-top:0">掃除前</h2>
      <p class="muted sm">
        清掃前の状態をまとめて撮っておきます（部屋ごとの指定は不要）。
        ${startPhotos.length ? html`<span>${startPhotos.length}枚</span>` : raw("")}
      </p>
      ${editable ? startCameraBtn(c, cl.id) : raw("")}
      ${startPhotos.length ? photoStrip(startPhotos) : raw("")}
    </div>
  `;
}

function startCameraBtn(c, cleaningId) {
  return html`
    <form class="photo-form" method="post" action="/cleanings/${cleaningId}/photos"
          enctype="multipart/form-data" data-cleaning="${cleaningId}">
      ${csrf(c)}
      <input type="hidden" name="kind" value="start" />
      <label class="photo-btn">
        <input type="file" name="full" accept="image/*" multiple />
        <span>📷 掃除前の写真を追加（複数選択可）</span>
      </label>
      <noscript><button type="submit" class="secondary sm">アップロード</button></noscript>
    </form>
  `;
}

function roomBlock(c, cl, r, editable, photosByItem, roomPhotosByName, roomInfo) {
  // 初期表示は折り畳み。作業する部屋を開いてもらう。
  const refPhotos = roomPhotosByName.get(r.name) || [];
  return html`
    <details class="card room-block" data-room-block="${r.name}">
      <summary class="room-sum">
        <span class="room-name">
          ${r.name}
          ${roomInfo?.memo ? html`<span class="room-memo-flag" title="引き継ぎメモあり">📝メモあり</span>` : raw("")}
        </span>
        <span class="muted sm ${r.total > 0 && r.done === r.total ? "room-done" : ""}"
              data-room-prog="${r.name}">${r.done}/${r.total}</span>
      </summary>
      ${roomInfo ? roomMemoForm(c, cl, roomInfo) : raw("")}
      ${refPhotos.length
        ? html`<div class="room-ref-photos">
            <span class="muted sm">仕上がりイメージ</span>
            ${roomPhotoStrip(refPhotos)}
          </div>`
        : raw("")}
      <ul class="items">
        ${r.items.map((it) => checkItem(c, cl, it, editable, photosByItem.get(it.id) || []))}
      </ul>
    </details>
  `;
}

/** 部屋ごとの引き継ぎメモ。room.memo に保存され、次回以降の清掃でも同じ内容が表示される */
function roomMemoForm(c, cl, room) {
  return html`
    <form method="post" action="/cleanings/${cl.id}/rooms/${room.id}/memo" class="room-memo">
      ${csrf(c)}
      <label class="fld">
        部屋のメモ（次回以降に引き継がれます）
        <textarea name="memo" rows="2" maxlength="2000" placeholder="例: 排水口が詰まりやすい／備品の置き場所 など">${room.memo || ""}</textarea>
      </label>
      <div class="room-memo-foot">
        <button type="submit" class="secondary">メモを保存</button>
        ${room.memo && room.memo_updated_at
          ? html`<span class="muted sm">
              最終更新: ${room.memo_updated_by_name ? `${room.memo_updated_by_name} ` : ""}${fmtDateTimeJst(room.memo_updated_at)}
            </span>`
          : raw("")}
      </div>
    </form>
  `;
}

function roomPhotoStrip(list) {
  return html`
    <div class="photos photos-sm">
      ${list.map(
        (p) => html`
          <a class="thumb" href="/room-photos/${p.id}?view=1">
            <img src="/room-photos/${p.id}?thumb=1&v=${encodeURIComponent(p.uploaded_at)}" alt="${p.caption || "参考写真"}" loading="lazy" />
          </a>
        `,
      )}
    </div>
  `;
}

function checkItem(c, cl, it, editable, itemPhotos = []) {
  const inner = html`
    <span class="mark">${it.checked ? "✓" : "○"}</span>
    <span class="lbl">${it.label}</span>
    ${it.checked && it.checked_by_name
      ? html`<span class="by muted sm">${it.checked_by_name}</span>`
      : raw("")}
  `;
  const toggle = editable
    ? html`
        <form method="post" action="/cleanings/${cl.id}/items/${it.id}/toggle" class="chk-form">
          ${csrf(c)}
          <button type="submit" class="chk-toggle" aria-pressed="${it.checked ? "true" : "false"}">
            ${inner}
          </button>
        </form>
      `
    : html`<div class="chk-toggle ro">${inner}</div>`;
  return html`
    <li class="chk-item ${it.checked ? "on" : ""}" data-room="${it.room_name}">
      <div class="chk-line">
        ${toggle}
        ${editable ? cameraBtn(c, cl.id, it.id, it.needs_photo) : raw("")}
      </div>
      ${itemPhotos.length ? photoStrip(itemPhotos, "sm") : raw("")}
    </li>
  `;
}

function cameraBtn(c, cleaningId, itemId, want) {
  return html`
    <form class="photo-form cam" method="post" action="/cleanings/${cleaningId}/photos"
          enctype="multipart/form-data" data-cleaning="${cleaningId}" data-item="${itemId}">
      ${csrf(c)}
      <input type="hidden" name="item_id" value="${itemId}" />
      <label class="cam-btn ${want ? "want" : ""}" title="写真を追加">
        <input type="file" name="full" accept="image/*" />
        <span aria-hidden="true">📷</span>
      </label>
    </form>
  `;
}

const UNGROUPED_ROOM = "未分類（間取り不明）";

/** photo を、紐づくチェック項目の間取り単位でまとめる。[{ name, sort, photos }]（room_sort 順、未分類は末尾） */
function groupPhotosByRoom(photos, items) {
  const roomByItemId = new Map(items.map((it) => [it.id, { name: it.room_name, sort: it.room_sort }]));
  const roomSortByName = new Map(items.map((it) => [it.room_name, it.room_sort]));
  const map = new Map();
  for (const p of photos) {
    let room = p.checklist_item_id ? roomByItemId.get(p.checklist_item_id) : null;
    if (!room && p.room_name) room = { name: p.room_name, sort: roomSortByName.get(p.room_name) ?? Infinity };
    const name = room ? room.name : UNGROUPED_ROOM;
    if (!map.has(name)) map.set(name, { sort: room ? room.sort : Infinity, photos: [] });
    map.get(name).photos.push(p);
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, sort: v.sort, photos: v.photos }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

function photoStrip(list, size = "") {
  return html`
    <div class="photos ${size === "sm" ? "photos-sm" : ""}">
      ${list.map(
        (p) => html`
          <a class="thumb" href="/photos/${p.id}?view=1">
            ${p.kind === "start" ? html`<span class="thumb-tag">掃除前</span>` : raw("")}
            <img src="/photos/${p.id}?thumb=1&v=${encodeURIComponent(p.uploaded_at)}" alt="${p.caption || "写真"}" loading="lazy" />
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
