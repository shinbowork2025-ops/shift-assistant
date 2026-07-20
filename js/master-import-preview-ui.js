function countRow(label, value) {
  const row = document.createElement("div");
  row.className = "master-import-count-row";
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  row.append(term, detail);
  return row;
}

export function confirmMasterImport(plan, { sourceLabel = "マスター", downloadErrors } = {}) {
  const dialog = document.querySelector("#masterImportPreviewDialog");
  const source = document.querySelector("#masterImportPreviewSource");
  const counts = document.querySelector("#masterImportPreviewCounts");
  const warning = document.querySelector("#masterImportPreviewWarning");
  const errorList = document.querySelector("#masterImportPreviewErrors");
  const downloadButton = document.querySelector("#masterImportErrorDownloadButton");
  const applyButton = document.querySelector("#masterImportApplyButton");
  if (!dialog || !source || !counts || !warning || !errorList || !downloadButton || !applyButton) {
    throw new Error("マスター取込プレビュー画面の構成が不正です。");
  }

  const summary = plan.summary;
  const errorRows = summary.errorRows ?? plan.errors.length;
  const breakPolicyErrors = summary.breakPolicyErrors ?? [];
  source.textContent = `${sourceLabel}を検証しました。まだデータは変更されていません。`;
  counts.replaceChildren(
    countRow("従業員", `追加${summary.addedEmployees}名・更新${summary.updatedEmployees}名・変更なし${summary.unchangedEmployees}名`),
    countRow("シフト", `追加${summary.addedShifts}件・更新${summary.updatedShifts}件・変更なし${summary.unchangedShifts}件`),
    countRow("休憩設定エラー", `${breakPolicyErrors.length}件`),
    countRow("読込不可", `${errorRows}行`)
  );

  const hasErrors = plan.errors.length > 0;
  const hasBreakPolicyErrors = breakPolicyErrors.length > 0;
  warning.hidden = !hasErrors && !hasBreakPolicyErrors;
  warning.textContent = hasErrors
    ? `${errorRows}行は反映されません。既定では取込を中止します。正常な行だけ反映する場合は、内容を確認して明示的に実行してください。`
    : hasBreakPolicyErrors
      ? `休憩設定エラーが${breakPolicyErrors.length}件あります。取込はできますが、修正するまで月間ソルバーは起動できません。`
      : "すべての行を検証しました。内容を確認してから取り込んでください。";
  const displayedIssues = [
    ...plan.errors,
    ...breakPolicyErrors.map((item) => `${item.line}行目: ${item.name || item.code}: ${item.issues.join(" / ")}`)
  ];
  errorList.replaceChildren(...displayedIssues.slice(0, 20).map((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    return item;
  }));
  errorList.hidden = displayedIssues.length === 0;
  if (displayedIssues.length > 20) {
    const item = document.createElement("li");
    item.textContent = `ほか${displayedIssues.length - 20}件`;
    errorList.append(item);
  }

  downloadButton.hidden = !hasErrors;
  downloadButton.onclick = () => downloadErrors?.(plan.errors);
  applyButton.disabled = plan.operations.every((operation) => operation.action === "unchanged");
  applyButton.textContent = hasErrors ? "正常な行だけ取り込む" : "すべて取り込む";
  applyButton.classList.toggle("danger", hasErrors);
  applyButton.classList.toggle("primary", !hasErrors);
  dialog.returnValue = "cancel";
  dialog.showModal();

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "apply"), { once: true });
  });
}
