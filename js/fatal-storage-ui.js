function diagnosticText(error) {
  const lines = [
    "Shift Assistant 保存データ読込失敗",
    `日時: ${new Date().toISOString()}`,
    `URL: ${globalThis.location?.href ?? "不明"}`,
    `ブラウザ: ${globalThis.navigator?.userAgent ?? "不明"}`,
    `エラー: ${error?.name ?? "Error"}: ${error?.message ?? String(error ?? "不明")}`
  ];
  return lines.join("\n");
}

function downloadDiagnostics(error) {
  const blob = new Blob([diagnosticText(error)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `shift-assistant-diagnostic-${new Date().toISOString().replaceAll(":", "-")}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function showFatalStorageLoadError(error) {
  document.documentElement.dataset.storageLoadFailed = "1";
  document.documentElement.removeAttribute("data-app-ready");
  document.body.classList.remove("auth-pending");
  document.querySelector("#authGate")?.setAttribute("hidden", "");

  for (const child of [...document.body.children]) {
    if (child.id !== "fatalStorageError") child.hidden = true;
  }

  let panel = document.querySelector("#fatalStorageError");
  if (!panel) {
    panel = document.createElement("main");
    panel.id = "fatalStorageError";
    panel.className = "app-main";
    panel.setAttribute("role", "alert");
    panel.innerHTML = `
      <section class="panel empty-state">
        <h1>保存データを読み込めませんでした</h1>
        <p>データ保護のため、編集と自動保存を開始していません。この画面で新しいシフト表を作成することはできません。</p>
        <p>まずページを再読み込みしてください。改善しない場合は、診断情報を保存して管理者へ渡し、別の正常な環境でバックアップを復元してください。</p>
        <div class="dialog-actions">
          <button id="fatalStorageReloadButton" class="button primary" type="button">再読み込み</button>
          <button id="fatalStorageDiagnosticButton" class="button secondary" type="button">診断情報を保存</button>
        </div>
        <p class="muted">エラー: <span id="fatalStorageErrorMessage"></span></p>
      </section>`;
    document.body.append(panel);
  }

  panel.hidden = false;
  panel.querySelector("#fatalStorageErrorMessage").textContent = error?.message ?? "不明な読込エラー";
  panel.querySelector("#fatalStorageReloadButton").onclick = () => globalThis.location.reload();
  panel.querySelector("#fatalStorageDiagnosticButton").onclick = () => downloadDiagnostics(error);
  panel.querySelector("#fatalStorageReloadButton").focus();
  return panel;
}

export { diagnosticText };
