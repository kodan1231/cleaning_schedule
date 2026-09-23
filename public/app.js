// クライアント JS。
// - Service Worker 登録
// - チェックリストの行タップでトグル（fetch）。JS 無効時はフォーム POST でフォールバック。
// - 完了ボタン: 未チェックがあれば確認ダイアログ。

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.warn("SW 登録失敗", e);
    });
  });
  // 新しい SW が制御を奪ったら一度だけリロードして最新アセットに切り替え
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    saveUiState();
    location.reload();
  });
}

// ── ページ再読み込みをまたいで UI 状態を保持（スクロール位置・開いている間取りアコーディオン） ──
// 並べ替えボタンや写真アップロードは reload を伴うため、そのたびに先頭へ戻ったり
// 開いていた間取りが閉じたりしないようにする。
function saveUiState() {
  const openRooms = [...document.querySelectorAll(".room-block[open]")].map((d) => d.dataset.roomBlock);
  sessionStorage.setItem("uiState", JSON.stringify({ scrollY: window.scrollY, openRooms }));
}
(() => {
  const raw = sessionStorage.getItem("uiState");
  if (raw == null) return;
  sessionStorage.removeItem("uiState");
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    return;
  }
  for (const name of state.openRooms || []) {
    const el = document.querySelector(`.room-block[data-room-block="${cssEscape(name)}"]`);
    if (el) el.open = true;
  }
  requestAnimationFrame(() => window.scrollTo(0, state.scrollY || 0));
})();

document.addEventListener("submit", (ev) => {
  const form = ev.target;
  const btn = ev.submitter;
  const action = (btn && btn.getAttribute("formaction")) || form.action;
  if (!action || !/\/(move|memo)$/.test(new URL(action, location.href).pathname)) return;
  saveUiState();
});

// ── チェックリスト トグル ──
document.addEventListener("submit", async (ev) => {
  const form = ev.target;
  if (!form.classList.contains("chk-form")) return;
  ev.preventDefault();

  const btn = form.querySelector("button");
  if (btn.disabled) return;
  btn.disabled = true;

  try {
    const res = await fetch(form.action, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new FormData(form),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "error");

    // 行の見た目
    const li = form.closest("li");
    li.classList.toggle("on", !!data.checked);
    btn.setAttribute("aria-pressed", data.checked ? "true" : "false");
    const mark = btn.querySelector(".mark");
    if (mark) mark.textContent = data.checked ? "✓" : "○";
    let by = btn.querySelector(".by");
    if (data.checked && data.checkedBy) {
      if (!by) {
        by = document.createElement("span");
        by.className = "by muted sm";
        btn.appendChild(by);
      }
      by.textContent = data.checkedBy;
    } else if (by) {
      by.remove();
    }

    // 進捗
    const roomDone = data.room.total > 0 && data.room.done === data.room.total;
    const roomEl = document.querySelector(
      `[data-room-prog="${cssEscape(data.room.name)}"]`,
    );
    if (roomEl) {
      roomEl.textContent = `${data.room.done}/${data.room.total}`;
      roomEl.classList.toggle("room-done", roomDone);
    }
    const overallEl = document.querySelector("[data-overall]");
    if (overallEl) overallEl.textContent = `${data.overall.done}/${data.overall.total}`;

    // 全部チェック済みの間取りは自動で閉じる（未完了に戻ったら開いたまま）
    const block = li.closest(".room-block");
    if (block && roomDone) block.open = false;

    // 完了フォームの未チェック件数
    const cf = document.querySelector("[data-complete-form]");
    if (cf) {
      const left = data.overall.total - data.overall.done;
      cf.dataset.incomplete = String(left);
      let note = cf.querySelector("[data-incomplete-note]");
      if (left > 0) {
        if (!note) {
          note = document.createElement("p");
          note.className = "muted sm";
          note.setAttribute("data-incomplete-note", "");
          cf.insertBefore(note, cf.querySelector("button"));
        }
        note.textContent = `未チェックの項目が ${left} 件あります。`;
      } else if (note) {
        note.remove();
      }
    }
  } catch (e) {
    console.warn("トグル失敗", e);
    // アラートは出さない（連続タップの邪魔になる）。行を一瞬赤くして知らせる。
    const li = form.closest("li");
    if (li) {
      li.classList.add("chk-failed");
      setTimeout(() => li.classList.remove("chk-failed"), 1500);
    }
  } finally {
    btn.disabled = false;
  }
});

// ── 完了ボタン: 未チェック確認 ──
document.addEventListener("submit", (ev) => {
  const form = ev.target;
  if (!form.hasAttribute("data-complete-form")) return;
  const left = parseInt(form.dataset.incomplete || "0", 10);
  if (left > 0 && !confirm(`未チェックの項目が ${left} 件あります。完了しますか？`)) {
    ev.preventDefault();
  }
});

function cssEscape(s) {
  return String(s).replace(/["\\]/g, "\\$&");
}

// ── ダイアログ（JS 有効時は data-dialog リンクでモーダルを開く）──
document.addEventListener("click", (ev) => {
  const opener = ev.target.closest("a[data-dialog]");
  if (opener) {
    const dlg = document.getElementById(opener.dataset.dialog);
    if (dlg && typeof dlg.showModal === "function") {
      ev.preventDefault();
      dlg.showModal();
    }
    return;
  }
  const closer = ev.target.closest("dialog [data-close]");
  if (closer) {
    ev.preventDefault();
    closer.closest("dialog").close();
  }
});

// ── 写真アップロード（クライアント縮小 → fetch）──
// input が multiple の場合（現状撮影など）は選んだ枚数ぶん、1枚ずつ順にアップロードする。
async function uploadOnePhoto(form, file) {
  const full = await makeJpeg(file, 1600, [0.82, 0.7, 0.6, 0.5], 1450000);
  const thumb = await makeJpeg(file, 400, [0.7], 300000);
  // フォーム内の他の入力（item_id・kind・caption 等）もそのまま引き継ぐ
  const fd = new FormData(form);
  fd.set("full", full, "photo.jpg");
  fd.set("thumb", thumb, "thumb.jpg");
  const res = await fetch(form.action, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "HTTP " + res.status);
}

document.addEventListener("change", async (ev) => {
  const input = ev.target;
  if (!input.matches(".photo-form input[type=file]")) return;
  const files = input.files ? Array.from(input.files) : [];
  if (!files.length) return;
  const form = input.closest(".photo-form");
  const label = form.querySelector("label span") || form.querySelector(".photo-btn");
  const orig = label ? label.textContent : "";
  form.classList.add("busy");

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    if (label) {
      label.textContent =
        files.length > 1 ? `アップロード中…（${i + 1}/${files.length}）` : "アップロード中…";
    }
    try {
      await uploadOnePhoto(form, files[i]);
      ok++;
    } catch (e) {
      console.warn("写真アップロード失敗", e);
      failed++;
    }
  }

  if (ok > 0) {
    if (failed > 0) alert(`${ok}枚アップロードしました（${failed}枚は失敗しました）`);
    saveUiState();
    location.reload();
    return;
  }

  alert("写真のアップロードに失敗しました");
  if (label) label.textContent = orig;
  form.classList.remove("busy");
  input.value = "";
});

function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      res(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error("画像を読み込めません"));
    };
    img.src = url;
  });
}

async function makeJpeg(file, maxEdge, qualities, sizeCap) {
  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const toBlob = (q) => new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
  let blob = null;
  for (const q of qualities) {
    blob = await toBlob(q);
    if (blob && (!sizeCap || blob.size <= sizeCap)) return blob;
  }
  return blob;
}

// ── 写真ビューア: スワイプ / 矢印キーで前後の写真に移動 ──
// data-prev / data-next は同じギャラリー内の隣の写真への URL（無ければ空文字）。
// ボタンでも移動できるので、これは無くても操作できる補助機能。
(() => {
  const view = document.querySelector(".photo-view");
  if (!view) return;
  const prevHref = view.dataset.prev || null;
  const nextHref = view.dataset.next || null;
  if (!prevHref && !nextHref) return;

  let startX = null;
  let startY = null;
  view.addEventListener(
    "touchstart",
    (ev) => {
      const t = ev.touches[0];
      startX = t.clientX;
      startY = t.clientY;
    },
    { passive: true },
  );
  view.addEventListener(
    "touchend",
    (ev) => {
      if (startX == null) return;
      const t = ev.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      startX = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0 && nextHref) location.href = nextHref;
      else if (dx > 0 && prevHref) location.href = prevHref;
    },
    { passive: true },
  );

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight" && nextHref) location.href = nextHref;
    else if (ev.key === "ArrowLeft" && prevHref) location.href = prevHref;
  });
})();
