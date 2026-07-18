export class ReleaseMismatchError extends Error {
  constructor(expected, actual) {
    super(`配布ファイルの版が一致しません。想定 ${expected} / 読込 ${actual}`);
    this.name = "ReleaseMismatchError";
    this.code = "RELEASE_MISMATCH";
    this.expected = expected;
    this.actual = actual;
  }
}

export function assertReleaseIntegrity(expected, actual) {
  if (!expected || !actual || expected !== actual) throw new ReleaseMismatchError(expected || "不明", actual || "不明");
  return actual;
}

export function showFatalReleaseMismatch(error) {
  document.documentElement.dataset.releaseMismatch = "1";
  document.documentElement.removeAttribute("data-app-ready");
  document.body.classList.remove("auth-pending");
  document.querySelector("#authGate")?.setAttribute("hidden", "");

  for (const child of [...document.body.children]) {
    if (child.id !== "fatalReleaseMismatch") child.hidden = true;
  }

  const panel = document.createElement("main");
  panel.id = "fatalReleaseMismatch";
  panel.className = "app-main";
  panel.setAttribute("role", "alert");
  panel.innerHTML = `
    <section class="panel empty-state">
      <h1>更新ファイルの版が一致しません</h1>
      <p>新旧の配布ファイルが混在しているため、データ保護のため編集を開始していません。</p>
      <p>ページを再読み込みしてください。改善しない場合は、ブラウザを完全に閉じてから開き直してください。</p>
      <div class="dialog-actions">
        <button id="fatalReleaseReloadButton" class="button primary" type="button">再読み込み</button>
      </div>
      <p class="muted">${error?.message ?? "配布版の確認に失敗しました。"}</p>
    </section>`;
  document.body.append(panel);
  panel.querySelector("#fatalReleaseReloadButton").onclick = () => globalThis.location.reload();
  panel.querySelector("#fatalReleaseReloadButton").focus();
  return panel;
}
