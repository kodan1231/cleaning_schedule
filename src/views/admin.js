import { html, raw } from "../lib/html.js";
import { authedPage } from "./layout.js";
import { fmtDateTimeJst } from "../lib/datetime.js";

// ─────────────────────────────────────────────
// 共通パーツ
// ─────────────────────────────────────────────
function csrf(c) {
  return html`<input type="hidden" name="_csrf" value="${c.get("csrf")}" />`;
}

function flash(msg, kind = "ok") {
  if (!msg) return raw("");
  return html`<div class="card ${kind === "err" ? "err" : "ok-note"}">${msg}</div>`;
}

function backLink(href, label) {
  return html`<p><a href="${href}">&larr; ${label}</a></p>`;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1e9) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(2)} GB`;
}


// ─────────────────────────────────────────────
// 管理トップ
// ─────────────────────────────────────────────
export function adminHome(c, { counts, properties, syncLogs = [], storage, msg }) {
  const activeProps = properties.filter((p) => p.active).length;
  const gb = storage ? storage.bytes / 1e9 : 0;
  const warn = gb >= 3;
  return authedPage(c, {
    title: "管理",
    active: "admin",
    body: html`
      <h1>管理メニュー</h1>
      ${flash(msg)}
      <div class="card">
        <div class="admin-links">
          <a class="btn secondary" href="/admin/properties">物件 (${counts.props})</a>
          <a class="btn secondary" href="/admin/templates">テンプレート (${counts.tpls})</a>
          <a class="btn secondary" href="/admin/users">ユーザー (${counts.users})</a>
        </div>
      </div>

      ${storage
        ? html`
            <div class="card ${warn ? "err" : ""}">
              <p class="${warn ? "" : "muted"}">
                写真: ${storage.photos}枚 / 約 ${fmtBytes(storage.bytes)}
                <span class="muted sm">（D1 無料枠 5GB・上限 10GB）</span>
              </p>
              ${warn
                ? html`<p class="sm"><strong>3GB を超えました。R2 への移行を検討してください（docs/02 §7.4）。</strong></p>`
                : raw("")}
            </div>
          `
        : raw("")}

      <h2 class="sub">物件の同期状況</h2>
      ${properties.length === 0
        ? html`<div class="card muted">物件が登録されていません。</div>`
        : html`
            ${activeProps > 0
              ? html`
                  <form method="post" action="/admin/sync-all" class="card">
                    ${csrf(c)}
                    <button type="submit">全物件を今すぐ同期</button>
                  </form>
                `
              : raw("")}
            <table class="tbl">
              <thead>
                <tr><th>物件</th><th>間取り</th><th>最終同期</th><th></th></tr>
              </thead>
              <tbody>
                ${properties.map(
                  (p) => html`
                    <tr class="${p.active ? "" : "row-off"}">
                      <td>
                        <a href="/admin/properties/${p.id}">${p.name}</a>
                        ${p.active ? raw("") : html`<span class="badge">無効</span>`}
                      </td>
                      <td>
                        ${p.room_count
                          ? html`${p.room_count} 室`
                          : html`<span class="muted">未設定</span>`}
                      </td>
                      <td>
                        ${p.last_sync
                          ? html`${fmtDateTimeJst(p.last_sync)}
                              <span class="status-${p.last_result === "ok" ? "done" : "in_progress"}">
                                ${p.last_result === "ok" ? "OK" : "エラー"}
                              </span>`
                          : html`<span class="muted">未同期</span>`}
                      </td>
                      <td>
                        ${p.active
                          ? html`
                              <form method="post" action="/admin/properties/${p.id}/sync" class="inline">
                                ${csrf(c)}
                                <button type="submit" class="secondary sm">同期</button>
                              </form>
                            `
                          : raw("")}
                      </td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          `}

      ${syncLogs.length > 0
        ? html`
            <h2 class="sub">最近の同期ログ</h2>
            <table class="tbl">
              <thead>
                <tr><th>日時</th><th>物件</th><th>結果</th><th>件数</th><th>メモ</th></tr>
              </thead>
              <tbody>
                ${syncLogs.map(
                  (l) => html`
                    <tr>
                      <td class="sm">${fmtDateTimeJst(l.run_at)}</td>
                      <td class="sm">${l.property || html`<span class="muted">—</span>`}</td>
                      <td>
                        <span class="status-${l.result === "ok" ? "done" : "in_progress"}">
                          ${l.result === "ok" ? "OK" : "エラー"}
                        </span>
                      </td>
                      <td class="sm">見 ${l.reservations_seen} / 生成 ${l.cleanings_created} / 更新 ${l.cleanings_updated}</td>
                      <td class="sm">${l.message || ""}</td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          `
        : raw("")}
    `,
  });
}

// ─────────────────────────────────────────────
// 物件一覧
// ─────────────────────────────────────────────
function propertyFields(c, p = {}) {
  return html`
    ${csrf(c)}
    <label class="fld">
      物件名
      <input type="text" name="name" value="${p.name || ""}" maxlength="60" required />
    </label>
    <label class="fld">
      iCal URL（Airbnb カレンダー）
      <input type="url" name="ical_url" value="${p.ical_url || ""}" maxlength="500" required />
    </label>
    <label class="fld">
      チェックアウト時刻
      <input type="time" name="checkout_time" value="${p.checkout_time || "10:00"}" required />
    </label>
    <label class="fld">
      メモ（任意）
      <textarea name="note" rows="2" maxlength="500">${p.note || ""}</textarea>
    </label>
  `;
}

export function propertyList(c, { properties, msg }) {
  return authedPage(c, {
    title: "物件",
    active: "admin",
    body: html`
      ${backLink("/admin", "管理メニュー")}
      <div class="dash-head">
        <h1>物件</h1>
        <a class="btn sm" href="/admin/properties/new" data-dialog="new-prop">＋ 物件を登録</a>
      </div>
      ${flash(msg)}

      ${properties.length === 0
        ? html`<div class="card muted">まだ物件がありません。「＋ 物件を登録」から追加してください。</div>`
        : html`
            <table class="tbl">
              <thead>
                <tr><th>物件名</th><th>間取り</th><th>状態</th></tr>
              </thead>
              <tbody>
                ${properties.map(
                  (p) => html`
                    <tr class="${p.active ? "" : "row-off"}">
                      <td><a href="/admin/properties/${p.id}">${p.name}</a></td>
                      <td>
                        ${p.room_count
                          ? html`${p.room_count} 室`
                          : html`<span class="muted">未設定</span>`}
                      </td>
                      <td>${p.active ? "有効" : html`<span class="muted">無効</span>`}</td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          `}

      <dialog id="new-prop">
        <form method="post" action="/admin/properties" class="form dialog-form">
          <h2>物件を登録</h2>
          ${propertyFields(c)}
          <div class="dialog-actions">
            <button type="button" class="secondary" data-close>キャンセル</button>
            <button type="submit">登録する</button>
          </div>
        </form>
      </dialog>
    `,
  });
}

// ─────────────────────────────────────────────
// 物件を登録（JS 無効時のフォールバックページ）
// ─────────────────────────────────────────────
export function newPropertyPage(c, { err } = {}) {
  return authedPage(c, {
    title: "物件を登録",
    active: "admin",
    body: html`
      ${backLink("/admin/properties", "物件一覧")}
      <h1>物件を登録</h1>
      ${flash(err, "err")}
      <form method="post" action="/admin/properties" class="card form">
        ${propertyFields(c)}
        <button type="submit">登録する</button>
      </form>
    `,
  });
}

// ─────────────────────────────────────────────
// 物件詳細（基本情報 + 間取り）
// ─────────────────────────────────────────────
function roomRow(c, propertyId, r, templates, idx, total) {
  return html`
    <form method="post" action="/admin/properties/${propertyId}/rooms/${r.id}" class="room-line" data-room-id="${r.id}">
      ${csrf(c)}
      <span class="room-grip" aria-hidden="true" title="ドラッグで並べ替え">⠿</span>
      <input class="room-name" type="text" name="name" value="${r.name}" maxlength="40" required />
      <input class="room-group" type="text" name="group_label" value="${r.group_label || ""}"
        maxlength="30" placeholder="グループ" list="room-groups" />
      <select name="template_id" class="room-tpl">
        <option value="">テンプレ未割当</option>
        ${templates.map(
          (t) => html`
            <option value="${t.id}" ${String(r.template_id) === String(t.id) ? "selected" : ""}>
              ${t.name}${t.items != null ? html` (${t.items})` : raw("")}
            </option>
          `,
        )}
      </select>
      <button type="submit" class="secondary sm" title="保存">保存</button>
      <span class="room-ops">
        <button type="submit" formaction="/admin/properties/${propertyId}/rooms/${r.id}/move"
          name="dir" value="up" class="linkbtn room-move" ${idx === 0 ? "disabled" : ""}>↑</button>
        <button type="submit" formaction="/admin/properties/${propertyId}/rooms/${r.id}/move"
          name="dir" value="down" class="linkbtn room-move" ${idx === total - 1 ? "disabled" : ""}>↓</button>
        <button type="submit" formaction="/admin/properties/${propertyId}/rooms/${r.id}/delete"
          class="linkbtn danger" onclick="return confirm('この間取りを削除しますか？')">✕</button>
      </span>
    </form>
  `;
}

export function propertyForm(c, { p, rooms = [], templates = [], msg, err }) {
  const roomsMissingTpl = rooms.filter((r) => !r.template_id).length;
  return authedPage(c, {
    title: p.name,
    active: "admin",
    body: html`
      ${backLink("/admin/properties", "物件一覧")}
      <h1>${p.name}</h1>
      ${flash(err, "err")}${flash(msg)}

      <form method="post" action="/admin/properties/${p.id}" class="card form">
        ${propertyFields(c, p)}
        <button type="submit">基本情報を保存</button>
      </form>

      <h2 class="sub">間取り <span class="muted sm">${rooms.length} 室</span></h2>
      <p class="muted sm">
        部屋ごとにチェックテンプレートを割り当てます。清掃はこれらをまとめて生成されます。
        「グループ」（例: 1階／2階／屋外）は清掃画面での折りたたみ表示に使います（任意）。
        ${roomsMissingTpl ? html`<br /><strong style="color:var(--orange)">テンプレ未割当の間取りが ${roomsMissingTpl} 室あります。</strong>` : raw("")}
      </p>

      <datalist id="room-groups">
        ${[...new Set(rooms.map((r) => r.group_label).filter(Boolean))].map(
          (g) => html`<option value="${g}"></option>`,
        )}
      </datalist>

      <div class="card room-list" data-reorder-url="/admin/properties/${p.id}/rooms/reorder">
        <div class="room-sortable">
          ${rooms.length === 0
            ? html`<p class="muted sm">まだ間取りがありません。</p>`
            : rooms.map((r, i) => roomRow(c, p.id, r, templates, i, rooms.length))}
        </div>
        <input type="hidden" name="_csrf" value="${c.get("csrf")}" data-reorder-csrf />
        <form method="post" action="/admin/properties/${p.id}/rooms" class="room-line room-add">
          ${csrf(c)}
          <input class="room-name" type="text" name="name" maxlength="40" placeholder="間取り名（例: キッチン）" required />
          <input class="room-group" type="text" name="group_label" maxlength="30" placeholder="グループ" list="room-groups" />
          <select name="template_id" class="room-tpl">
            <option value="">テンプレ未割当</option>
            ${templates.map(
              (t) => html`<option value="${t.id}">${t.name}${t.items != null ? html` (${t.items})` : raw("")}</option>`,
            )}
          </select>
          <button type="submit" class="sm">追加</button>
        </form>
      </div>
      ${rooms.length > 1
        ? html`<p class="muted sm">間取りは <span class="room-dnd-hint">↑↓ で並べ替え</span> できます。</p>`
        : raw("")}
      <p class="muted sm">
        テンプレートは <a href="/admin/templates">テンプレート管理</a> で作成・編集します。
      </p>

      <form method="post" action="/admin/properties/${p.id}/resnapshot" class="card form"
            onsubmit="return confirm('未完了の清掃のチェックリストを現在のテンプレートで作り直します。チェック状態はリセットされます。よろしいですか？')">
        ${csrf(c)}
        <p class="muted sm">
          間取り／テンプレを変更したあと、既存の未完了清掃にも反映したいときに押します
          （同期時にも自動で反映されます）。
        </p>
        <button type="submit" class="secondary">チェックリストを再生成</button>
      </form>

      <form method="post" action="/admin/properties/${p.id}/toggle" class="card form">
        ${csrf(c)}
        <p class="muted">
          この物件は現在 <strong>${p.active ? "有効" : "無効"}</strong> です。
          無効にすると同期対象から外れます（データは保持）。
        </p>
        <button type="submit" class="secondary">
          ${p.active ? "無効にする" : "有効に戻す"}
        </button>
      </form>
    `,
  });
}

// ─────────────────────────────────────────────
// テンプレート一覧
// ─────────────────────────────────────────────
export function templateList(c, { templates, msg, err }) {
  return authedPage(c, {
    title: "テンプレート",
    active: "admin",
    body: html`
      ${backLink("/admin", "管理メニュー")}
      <h1>チェックリストテンプレート</h1>
      ${flash(err, "err")}${flash(msg)}

      <table class="tbl">
        <thead>
          <tr><th>名称</th><th>項目数</th><th>使用間取り</th></tr>
        </thead>
        <tbody>
          ${templates.map(
            (t) => html`
              <tr>
                <td><a href="/admin/templates/${t.id}">${t.name}</a></td>
                <td>${t.items}</td>
                <td>${t.rooms}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>

      <h2 class="sub">テンプレートを追加</h2>
      <form method="post" action="/admin/templates" class="card form">
        ${csrf(c)}
        <label class="fld">
          名称（例: キッチン用 / 浴室用）
          <input type="text" name="name" maxlength="60" required />
        </label>
        <button type="submit">追加する</button>
      </form>
    `,
  });
}

// ─────────────────────────────────────────────
// テンプレート編集（項目の追加/編集/削除/並替。項目はフラットな1リスト）
// ─────────────────────────────────────────────
export function templateEditor(c, { t, items = [], roomCount = 0, msg, err }) {
  return authedPage(c, {
    title: t.name,
    active: "admin",
    body: html`
      ${backLink("/admin/templates", "テンプレート一覧")}
      <h1>${t.name}</h1>
      ${flash(err, "err")}${flash(msg)}

      <form method="post" action="/admin/templates/${t.id}" class="card form">
        ${csrf(c)}
        <label class="fld">
          名称
          <input type="text" name="name" value="${t.name}" maxlength="60" required />
        </label>
        <button type="submit">名称を保存</button>
      </form>

      <div class="card row-actions">
        <form method="post" action="/admin/templates/${t.id}/clone" class="inline">
          ${csrf(c)}
          <button type="submit" class="secondary">複製する</button>
        </form>
        <form method="post" action="/admin/templates/${t.id}/delete" class="inline"
              onsubmit="return confirm('このテンプレートを削除しますか？')">
          ${csrf(c)}
          <button type="submit" class="secondary danger" ${roomCount > 0 ? "disabled" : ""}>削除する</button>
        </form>
        ${roomCount > 0
          ? html`<span class="muted sm">${roomCount} 件の間取りに割当中のため削除できません。</span>`
          : raw("")}
      </div>

      <h2 class="sub">項目</h2>
      ${items.length === 0
        ? html`<div class="card muted">まだ項目がありません。下のフォームから追加してください。</div>`
        : html`
            <div class="card">
              <ul class="items">
                ${items.map((it, i) => templateItemRow(c, t.id, it, i, items.length))}
              </ul>
            </div>
          `}

      <h2 class="sub">項目を追加</h2>
      <form method="post" action="/admin/templates/${t.id}/items" class="card form">
        ${csrf(c)}
        <label class="fld">
          ラベル
          <input type="text" name="label" maxlength="120" required />
        </label>
        <label class="fld chk">
          <input type="checkbox" name="needs_photo" value="1" />
          写真の目印をつける
        </label>
        <label class="fld">
          補足（任意）
          <input type="text" name="note" maxlength="200" />
        </label>
        <button type="submit">項目を追加</button>
      </form>
    `,
  });
}

function templateItemRow(c, tplId, it, idx, total) {
  return html`
    <li class="item">
      <details>
        <summary>
          ${it.label}
          ${it.needs_photo ? html`<span class="badge photo">写真</span>` : raw("")}
        </summary>
        <form method="post" action="/admin/templates/${tplId}/items/${it.id}" class="form sub-form">
          ${csrf(c)}
          <label class="fld">
            ラベル
            <input type="text" name="label" value="${it.label}" maxlength="120" required />
          </label>
          <label class="fld chk">
            <input type="checkbox" name="needs_photo" value="1" ${it.needs_photo ? "checked" : ""} />
            写真の目印をつける
          </label>
          <label class="fld">
            補足
            <input type="text" name="note" value="${it.note || ""}" maxlength="200" />
          </label>
          <button type="submit">保存</button>
        </form>
        <div class="row-actions">
          <form method="post" action="/admin/templates/${tplId}/items/${it.id}/move" class="inline">
            ${csrf(c)}
            <input type="hidden" name="dir" value="up" />
            <button type="submit" class="secondary" ${idx === 0 ? "disabled" : ""}>↑</button>
          </form>
          <form method="post" action="/admin/templates/${tplId}/items/${it.id}/move" class="inline">
            ${csrf(c)}
            <input type="hidden" name="dir" value="down" />
            <button type="submit" class="secondary" ${idx === total - 1 ? "disabled" : ""}>↓</button>
          </form>
          <form method="post" action="/admin/templates/${tplId}/items/${it.id}/delete" class="inline"
                onsubmit="return confirm('この項目を削除しますか？')">
            ${csrf(c)}
            <button type="submit" class="secondary danger">削除</button>
          </form>
        </div>
      </details>
    </li>
  `;
}

// ─────────────────────────────────────────────
// ユーザー管理
// ─────────────────────────────────────────────
export function userList(c, { users, registrationOpen, inviteUrl, msg, err, newPin }) {
  const me = c.get("user");
  return authedPage(c, {
    title: "ユーザー",
    active: "admin",
    body: html`
      ${backLink("/admin", "管理メニュー")}
      <h1>ユーザー管理</h1>
      ${flash(err, "err")}${flash(msg)}
      ${newPin
        ? html`<div class="card ok-note">
            <strong>${newPin.name}</strong> の新しい PIN: <span class="mono big">${newPin.pin}</span><br />
            <span class="muted sm">この画面を閉じると再表示できません。本人に伝えてください。</span>
          </div>`
        : raw("")}

      <div class="card">
        <p class="muted">
          登録受付: <strong>${registrationOpen ? "受付中" : "停止中"}</strong>
          （現在 ${users.length} 名・人数上限なし）
        </p>
        <form method="post" action="/admin/registration" class="inline">
          ${csrf(c)}
          <input type="hidden" name="open" value="${registrationOpen ? "0" : "1"}" />
          <button type="submit" class="secondary">
            ${registrationOpen ? "受付を停止" : "受付を再開"}
          </button>
        </form>
      </div>

      ${inviteUrl
        ? html`
            <div class="card">
              <h3>メンバーを招待</h3>
              <p class="muted sm">
                この URL をチームに共有すると、各自が表示名と PIN を登録できます。
                ${registrationOpen
                  ? raw("")
                  : html`<br /><strong>現在は受付停止中です。上の「受付を再開」を押してください。</strong>`}
              </p>
              <input class="invite-url mono" type="text" readonly value="${inviteUrl}"
                onclick="this.select()" />
            </div>
          `
        : raw("")}

      ${users.map(
        (u) => html`
          <div class="card user-row ${u.active ? "" : "row-off"}">
            <div class="user-head">
              <strong>${u.name}</strong>
              ${u.id === me.id ? html`<span class="badge">自分</span>` : raw("")}
              <span class="badge">${u.role === "admin" ? "管理者" : "メンバー"}</span>
              ${u.active ? raw("") : html`<span class="badge">無効</span>`}
              ${u.locked ? html`<span class="badge photo">ロック中</span>` : raw("")}
            </div>
            <form method="post" action="/admin/users/${u.id}/name" class="form-row">
              ${csrf(c)}
              <input type="text" name="name" value="${u.name}" maxlength="30" required />
              <button type="submit" class="secondary sm">名前を変更</button>
            </form>
            <div class="row-actions">
              <form method="post" action="/admin/users/${u.id}/role" class="inline">
                ${csrf(c)}
                <input type="hidden" name="role" value="${u.role === "admin" ? "member" : "admin"}" />
                <button type="submit" class="secondary sm">
                  ${u.role === "admin" ? "メンバーにする" : "管理者にする"}
                </button>
              </form>
              <form method="post" action="/admin/users/${u.id}/toggle" class="inline">
                ${csrf(c)}
                <button type="submit" class="secondary sm" ${u.id === me.id ? "disabled" : ""}>
                  ${u.active ? "無効化" : "有効化"}
                </button>
              </form>
              <form method="post" action="/admin/users/${u.id}/reset-pin" class="inline"
                    onsubmit="return confirm('${u.name} の PIN をリセットしますか？')">
                ${csrf(c)}
                <button type="submit" class="secondary sm">PINリセット</button>
              </form>
            </div>
          </div>
        `,
      )}
    `,
  });
}
