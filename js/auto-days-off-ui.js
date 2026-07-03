import { state, monthDisplayName } from "./model.js";
import { findDefaultDaysOffShiftCode } from "./auto-days-off.js";
import {
  createCurrentDaysOffPlan,
  applyCurrentDaysOffPlan
} from "./actions/auto-days-off-actions.js";

let controls = null;
let setStatus = () => {};
let currentPlan = null;

function loadStylesheet() {
  if (document.querySelector('link[href="./auto-days-off.css"]')) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "./auto-days-off.css";
  document.head.append(stylesheet);
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function createDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "auto-days-off-dialog";
  const form = document.createElement("form");
  form.method = "dialog";

  const header = document.createElement("div");
  header.className = "dialog-header";
  const title = document.createElement("h2");
  title.textContent = "公休を自動配置";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "icon-button";
  closeButton.setAttribute("aria-label", "閉じる");
  closeButton.textContent = "×";
  header.append(title, closeButton);

  const shiftSelect = document.createElement("select");
  shiftSelect.id = "autoDaysOffShiftSelect";
  const shiftLabel = document.createElement("label");
  shiftLabel.append(document.createTextNode("配置する休日区分"), shiftSelect);

  const modeSelect = document.createElement("select");
  modeSelect.id = "autoDaysOffModeSelect";
  modeSelect.append(
    createOption("empty-only", "空欄だけに公休を入れる（安全）"),
    createOption("replace-unlocked", "未ロックの公休を再配置する")
  );
  const modeLabel = document.createElement("label");
  modeLabel.append(document.createTextNode("配置モード"), modeSelect);

  const note = document.createElement("p");
  note.className = "auto-days-off-note";
  note.textContent = "ロック済みセル、有休など公休以外の休日区分は変更しません。再配置モードでは未ロックの勤務シフトを公休へ置き換える場合があります。";

  const preview = document.createElement("div");
  preview.className = "auto-days-off-preview";
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
  applyButton.textContent = "この内容で配置";
  actions.append(spacer, cancelButton, applyButton);

  form.append(header, shiftLabel, modeLabel, note, preview, actions);
  dialog.append(form);
  document.body.append(dialog);
  closeButton.addEventListener("click", () => dialog.close());
  cancelButton.addEventListener("click", () => dialog.close());
  shiftSelect.addEventListener("change", updatePreview);
  modeSelect.addEventListener("change", updatePreview);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentPlan) return;
    const result = applyCurrentDaysOffPlan(currentPlan);
    dialog.close();
    renderResult(result);
    const summary = result.summary;
    setStatus(`公休の自動配置：${result.applied}セル変更、警告${summary.warningCount}件`);
  });
  return { dialog, shiftSelect, modeSelect, preview, applyButton };
}

function createMainControls() {
  const heading = document.querySelector("#monthPanel .schedule-heading");
  const clearButton = document.getElementById("clearMonthButton");
  if (!heading || !clearButton) return null;
  let actionArea = heading.querySelector(".month-generation-actions");
  if (!actionArea) {
    actionArea = document.createElement("div");
    actionArea.className = "month-generation-actions";
    clearButton.before(actionArea);
    actionArea.append(clearButton);
  }
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "button primary";
  openButton.textContent = "公休を自動配置";
  actionArea.prepend(openButton);

  const result = document.createElement("section");
  result.className = "auto-days-off-result";
  result.hidden = true;
  result.setAttribute("aria-live", "polite");
  const resultsSlot = document.querySelector("#monthResultsSlot");
  if (resultsSlot) resultsSlot.append(result);
  else heading.insertAdjacentElement("afterend", result);
  openButton.addEventListener("click", openDialog);
  return { openButton, result };
}

function populateShiftOptions() {
  const options = state.shiftTypes.filter((shiftType) => !shiftType.isWork);
  const previous = controls.dialog.shiftSelect.value;
  controls.dialog.shiftSelect.replaceChildren();
  for (const shiftType of options) {
    controls.dialog.shiftSelect.append(createOption(shiftType.code, `${shiftType.name}（${shiftType.code}）`));
  }
  const defaultCode = previous && options.some((item) => item.code === previous)
    ? previous
    : findDefaultDaysOffShiftCode(state.shiftTypes);
  controls.dialog.shiftSelect.value = defaultCode;
  controls.dialog.applyButton.disabled = options.length === 0;
}

function previewEmployeeRows(plan) {
  const fragment = document.createDocumentFragment();
  const list = document.createElement("ul");
  list.className = "auto-days-off-employee-list";
  for (const result of plan.employeeResults) {
    const item = document.createElement("li");
    item.classList.toggle("warning", result.warnings.length > 0);
    item.textContent = result.skipped
      ? `${result.employeeName}：対象外`
      : `${result.employeeName}：${result.patternName}／休日${result.actualDaysOff}日／最大${result.longestWorkStreak}連勤`;
    list.append(item);
  }
  fragment.append(list);
  return fragment;
}

function updatePreview() {
  if (!controls) return;
  try {
    currentPlan = createCurrentDaysOffPlan({
      offShiftCode: controls.dialog.shiftSelect.value,
      mode: controls.dialog.modeSelect.value
    });
    const summary = currentPlan.summary;
    const heading = document.createElement("strong");
    heading.textContent = `${monthDisplayName(state.selectedMonth)}：追加${summary.placed}、上書き${summary.overwritten}、解除${summary.cleared}`;
    const details = document.createElement("p");
    details.textContent = `設定済み${summary.processedEmployees}名／対象外${summary.skippedEmployees}名／警告${summary.warningCount}件`;
    const fragment = document.createDocumentFragment();
    fragment.append(heading, details, previewEmployeeRows(currentPlan));
    if (currentPlan.warnings.length) {
      const warnings = document.createElement("details");
      const summaryElement = document.createElement("summary");
      summaryElement.textContent = `警告を表示（${currentPlan.warnings.length}件）`;
      const list = document.createElement("ul");
      currentPlan.warnings.forEach((message) => {
        const item = document.createElement("li");
        item.textContent = message;
        list.append(item);
      });
      warnings.append(summaryElement, list);
      fragment.append(warnings);
    }
    controls.dialog.preview.replaceChildren(fragment);
    controls.dialog.applyButton.disabled = summary.processedEmployees === 0;
  } catch (error) {
    currentPlan = null;
    controls.dialog.preview.textContent = error.message;
    controls.dialog.applyButton.disabled = true;
  }
}

function openDialog() {
  populateShiftOptions();
  controls.dialog.modeSelect.value = "empty-only";
  updatePreview();
  controls.dialog.dialog.showModal();
}

function renderResult(result) {
  const panel = controls.main.result;
  const heading = document.createElement("strong");
  heading.textContent = `${monthDisplayName(result.monthValue)}の公休配置結果`;
  const summary = document.createElement("p");
  summary.textContent = `${result.applied}セルを変更しました。追加${result.summary.placed}、勤務から変更${result.summary.overwritten}、旧公休の解除${result.summary.cleared}。`;
  const fragment = document.createDocumentFragment();
  fragment.append(heading, summary);
  if (result.warnings.length) {
    const list = document.createElement("ul");
    result.warnings.forEach((message) => {
      const item = document.createElement("li");
      item.textContent = message;
      list.append(item);
    });
    fragment.append(list);
  } else {
    const okay = document.createElement("p");
    okay.textContent = "警告はありません。必要に応じてセルをロックしてから次の自動調整へ進めます。";
    fragment.append(okay);
  }
  panel.replaceChildren(fragment);
  panel.hidden = false;
}

function syncButton() {
  if (controls) controls.main.openButton.disabled = state.employees.length === 0;
}

export function initializeAutoDaysOffUi(options = {}) {
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
