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
    const areaEl = document.querySelector(
      `[data-area-prog="${cssEscape(data.area.label)}"]`,
    );
    if (areaEl) areaEl.textContent = `${data.area.done}/${data.area.total}`;
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
