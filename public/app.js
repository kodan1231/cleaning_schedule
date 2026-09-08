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
    location.reload();
  });
}

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
    const roomEl = document.querySelector(
      `[data-room-prog="${cssEscape(data.room.name)}"]`,
    );
    if (roomEl) roomEl.textContent = `${data.room.done}/${data.room.total}`;
    const overallEl = document.querySelector("[data-overall]");
    if (overallEl) overallEl.textContent = `${data.overall.done}/${data.overall.total}`;

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
    alert("更新に失敗しました。通信状況を確認してください。");
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

// ── 写真アップロード（クライアント縮小 → fetch）──
document.addEventListener("change", async (ev) => {
  const input = ev.target;
  if (!input.matches(".photo-form input[type=file]")) return;
  const file = input.files && input.files[0];
  if (!file) return;
  const form = input.closest(".photo-form");
  const label = form.querySelector(".photo-btn span");
  const orig = label ? label.textContent : "";
  if (label) label.textContent = "処理中…";
  form.classList.add("busy");

  try {
    const full = await makeJpeg(file, 1600, [0.82, 0.7, 0.6, 0.5], 1450000);
    const thumb = await makeJpeg(file, 400, [0.7], 300000);
    const fd = new FormData();
    fd.set("_csrf", form.querySelector('input[name=_csrf]').value);
    const itemId = form.dataset.item;
    if (itemId) fd.set("item_id", itemId);
    fd.set("full", full, "photo.jpg");
    fd.set("thumb", thumb, "thumb.jpg");
    if (label) label.textContent = "アップロード中…";
    const res = await fetch(form.action, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "HTTP " + res.status);
    location.reload();
  } catch (e) {
    console.warn("写真アップロード失敗", e);
    alert("写真のアップロードに失敗しました: " + (e.message || e));
    if (label) label.textContent = orig;
    form.classList.remove("busy");
    input.value = "";
  }
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
