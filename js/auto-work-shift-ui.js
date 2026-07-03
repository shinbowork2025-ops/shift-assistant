import { state, monthDisplayName } from "./model.js";
import {
  createCurrentWorkShiftPlan,
  applyCurrentWorkShiftPlan
} from "./actions/auto-work-shift-actions.js";

let controls = null;
let setStatus = () => {};
let currentPlan = null;

function loadStylesheet() {
  if (document.querySelector('link[href="./auto-work-shift.css"]')) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "./auto-work-shift.css";
  document.head.append(stylesheet);
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function selectedShiftCodes() {
  return controls.dialog.shiftInputs.filter((input) => input.checked).map((input) => input.value);
}

function createDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "auto-work-shift-dialog";
  const form = document.createElement("form");
  form.method = "dialog";

  const header = document.createElement("div");
  header.className = "dialog-header";
  const title = document.createElement("h2");
  title.textContent = "勤務シフトを自動割当";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "icon-button";
  closeButton.setAttribute("aria-label", "閉じる");
  closeButton.textContent = "×";
  header.append(title, closeButton);

  const modeSelect = document.createElement("select");
  modeSelect.append(
    createOption("empty-only", "空欄だけに勤務シフトを入れる（安全）"),
    createOption("replace-unlocked-work", "未ロックの勤務シフトを再割当する")
  );
  const modeLabel = document.createElement("label");
  modeLabel.append(document.createTextNode("割当モード"), modeSelect);

  const candidateFieldset = document.createElement("fieldset");
  candidateFieldset.className = "auto-work-candidates";
  const candidateLegend = document.createElement("legend");
  candidateLegend.textContent = "今回使う勤務シフト";
  const candidateToolbar = document.createElement("div");
  candidateToolbar.className = "auto-work-candidate-toolbar";
  const selectAllButton = document.createElement("button");
  selectAllButton.type = "button";
  selectAllButton.className = "button secondary compact";
  selectAllButton.textContent = "全て選択";
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "button secondary compact";
  clearButton.textContent = "全て解除";
  const candidateCount = document.createElement("span");
  candidateToolbar.append(selectAllButton, clearButton, candidateCount);
  const candidateList = document.createElement("div");
  candidateList.className = "auto-work-candidate-list";
  candidateFieldset.append(candidateLegend, candidateToolbar, candidateList);

  const note = document.createElement("p");
  note.className = "auto-work-note";
  note.textContent = "公休・有休などの休日区分とロック済みセルは変更しません。従業員ごとの使用可能シフト、優先シフト、勤務間隔、時間帯の偏り、固定残業枠を考慮します。";

  const preview = document.createElement("div");
  preview.className = "auto-work-preview";
  preview.setAttribute("aria-live", "polite");

  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "button secondary";
  cancelButton.textContent = "キャンセル";
  const applyButton = document.createElement("button");
  applyButton.type = "submit";
  applyButton.className = "button primary";
  applyButton.textContent = "この内容で割当";
  actions.append(spacer, cancelButton, applyButton);

  form.append(header, modeLabel, candidateFieldset, note, preview, actions);
  dialog.append(form);
  document.body.append(dialog);

  const result = {
    dialog,
    modeSelect,
    candidateList,
    candidateCount,
    shiftInputs: [],
    selectAllButton,
    clearButton,
    preview,
    applyButton
  };

  closeButton.addEventListener("click", () => dialog.close());
  cancelButton.addEventListener("click", () => dialog.close());
  modeSelect.addEventListener("change", updatePreview);
  candidateList.addEventListener("change", updatePreview);
  selectAllButton.addEventListener("click", () => {
    result.shiftInputs.forEach((input) => { input.checked = true; });
    updatePreview();
  });
  clearButton.addEventListener("click", () => {
    result.shiftInputs.forEach((input) => { input.checked = false; });
    updatePreview();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentPlan) return;
    const applied = applyCurrentWorkShiftPlan(currentPlan);
    dialog.close();
    renderResult(applied);
    setStatus(`勤務シフト自動割当：${applied.applied}セル変更、警告${applied.summary.warningCount}件`);
  });
  return result;
}

function createMainControls() {
  const heading = document.querySelector("#monthPanel .schedule-heading");
  const actionArea = heading?.querySelector(".month-generation-actions");
  if (!heading || !actionArea) return null;

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "button primary";
  openButton.textContent = "勤務を自動割当";
  const clearMonthButton = actionArea.querySelector("#clearMonthButton");
  if (clearMonthButton) actionArea.insertBefore(openButton, clearMonthButton);
  else actionArea.append(openButton);

  const result = document.createElement("section");
  result.className = "auto-work-result";
  result.hidden = true;
  result.setAttribute("aria-live", "polite");
  const daysOffResult = document.querySelector(".auto-days-off-result");
  if (daysOffResult) daysOffResult.insertAdjacentElement("afterend", result);
  else heading.insertAdjacentElement("afterend", result);
  openButton.addEventListener("click", openDialog);
  return { openButton, result };
}

function populateCandidates() {
  const workTypes = state.shiftTypes.filter((shiftType) => shiftType.isWork && shiftType.start && shiftType.end);
  const fragment = document.createDocumentFragment();
  controls.dialog.shiftInputs = [];
  for (const shiftType of workTypes) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = shiftType.code;
    input.checked = true;
    const text = document.createElement("span");
    text.textContent = `${shiftType.code} ${shiftType.name} ${shiftType.start}〜${shiftType.end}`;
    label.append(input, text);
    fragment.append(label);
    controls.dialog.shiftInputs.push(input);
  }
  controls.dialog.candidateList.replaceChildren(fragment);
}

function employeeRows(plan) {
  const list = document.createElement("ul");
  list.className = "auto-work-employee-list";
  for (const result of plan.employeeResults) {
    const item = document.createElement("li");
    item.classList.toggle("warning", result.warnings.length > 0);
    const overtime = Math.round(result.projectedOvertimeMinutes / 6) / 10;
    item.textContent = `${result.employeeName}：${result.assignedCells}/${result.eligibleCells}セル／候補${result.allowedShiftCount}種／残業見込${overtime}h`;
    list.append(item);
  }
  return list;
}

function warningDetails(plan) {
  if (!plan.warnings.length) return null;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `警告を表示（${plan.warnings.length}件）`;
  const list = document.createElement("ul");
  plan.warnings.forEach((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    list.append(item);
  });
  details.append(summary, list);
  return details;
}

function updatePreview() {
  if (!controls) return;
  const selectedCodes = selectedShiftCodes();
  controls.dialog.candidateCount.textContent = `${selectedCodes.length}/${controls.dialog.shiftInputs.length}種類を使用`;
  try {
    currentPlan = createCurrentWorkShiftPlan({
      selectedShiftCodes: selectedCodes,
      mode: controls.dialog.modeSelect.value
    });
    const summary = currentPlan.summary;
    const heading = document.createElement("strong");
    heading.textContent = `${monthDisplayName(state.selectedMonth)}：新規${summary.placed}、再割当${summary.reassigned}、変更なし${summary.unchanged}`;
    const details = document.createElement("p");
    details.textContent = `対象${summary.eligibleCells}セル／割当${summary.assignedCells}セル／固定残業超過見込${summary.overtimeExceededEmployees}名／警告${summary.warningCount}件`;
    const fragment = document.createDocumentFragment();
    fragment.append(heading, details, employeeRows(currentPlan));
    const warnings = warningDetails(currentPlan);
    if (warnings) fragment.append(warnings);
    controls.dialog.preview.replaceChildren(fragment);
    controls.dialog.applyButton.disabled = summary.assignedCells === 0;
  } catch (error) {
    currentPlan = null;
    controls.dialog.preview.textContent = error.message;
    controls.dialog.applyButton.disabled = true;
  }
}

function openDialog() {
  populateCandidates();
  controls.dialog.modeSelect.value = "empty-only";
  updatePreview();
  controls.dialog.dialog.showModal();
}

function renderResult(result) {
  const panel = controls.main.result;
  const heading = document.createElement("strong");
  heading.textContent = `${monthDisplayName(result.monthValue)}の勤務シフト割当結果`;
  const summary = document.createElement("p");
  summary.textContent = `${result.applied}セルを変更しました。新規${result.summary.placed}、再割当${result.summary.reassigned}、ロック再確認によるスキップ${result.skippedLocked}。`;
  const fragment = document.createDocumentFragment();
  fragment.append(heading, summary);
  const warnings = warningDetails(result);
  if (warnings) fragment.append(warnings);
  else {
    const okay = document.createElement("p");
    okay.textContent = "警告はありません。1日チャートで時間帯配置と休憩を確認してください。";
    fragment.append(okay);
  }
  panel.replaceChildren(fragment);
  panel.hidden = false;
}

function syncButton() {
  if (!controls) return;
  controls.main.openButton.disabled = state.employees.length === 0 || !state.shiftTypes.some((shiftType) => shiftType.isWork);
}

export function initializeAutoWorkShiftUi(options = {}) {
  if (controls) return controls;
  loadStylesheet();
  setStatus = options.setStatus ?? setStatus;
  const main = createMainControls();
  if (!main) return null;
  controls = { main, dialog: createDialog() };
  const table = document.getElementById("tableContainer");
  if (table) new MutationObserver(syncButton).observe(table, { childList: true });
  syncButton();
  return controls;
}
