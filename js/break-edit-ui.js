import { state, getShiftType, getBreaks, dayFromDate, dateDisplayName } from "./model.js";
import { validateBreaks } from "./break-rules.js";
import { roundToQuarterHour } from "./break-time-grid.js";
import { isManualBreakLockedInData } from "./manual-break-locks.js";
import { saveEmployeeBreaks } from "./actions/break-edit-actions.js";

let controls = null;
let setStatus = () => {};
let currentEmployee = null;

function labeledControl(labelText, control) {
  const label = document.createElement("label");
  label.className = "break-edit-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

function createRow(breakItem = {}) {
  const row = document.createElement("div");
  row.className = "break-edit-row";
  const type = document.createElement("select");
  for (const [value, label] of [["small", "小休憩"], ["lunch", "昼休憩"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    type.append(option);
  }
  type.value = breakItem.type === "lunch" ? "lunch" : "small";
  const start = document.createElement("input");
  start.type = "time";
  start.step = "900";
  start.value = breakItem.start ?? "";
  const end = document.createElement("input");
  end.type = "time";
  end.step = "900";
  end.value = breakItem.end ?? "";
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "button danger-ghost compact break-edit-remove";
  removeButton.textContent = "削除";
  removeButton.addEventListener("click", () => {
    row.remove();
    updateEmptyHint();
    updatePreview();
  });
  for (const control of [type, start, end]) control.addEventListener("change", updatePreview);
  row.append(labeledControl("種類", type), labeledControl("開始", start), labeledControl("終了", end), removeButton);
  row._readBreak = () => ({
    type: type.value,
    label: type.value === "lunch" ? "昼休憩" : "小休憩",
    start: start.value ? roundToQuarterHour(start.value) : "",
    end: end.value ? roundToQuarterHour(end.value) : ""
  });
  row._focusInvalid = () => (!start.value ? start : end).focus();
  return row;
}

function updateEmptyHint() {
  if (!controls) return;
  controls.emptyHint.hidden = Boolean(controls.list.querySelector(".break-edit-row"));
}

function collectBreaks() {
  const breaks = [];
  const incompleteRows = [];
  [...controls.list.querySelectorAll(".break-edit-row")].forEach((row, index) => {
    const item = row._readBreak();
    if (!item.start && !item.end) {
      incompleteRows.push({ row, index, message: `${index + 1}件目の開始・終了時刻が未入力です。` });
      return;
    }
    if (!item.start || !item.end) {
      incompleteRows.push({ row, index, message: `${index + 1}件目の開始または終了時刻が未入力です。` });
      return;
    }
    breaks.push(item);
  });
  return { breaks, incompleteRows };
}

function currentValidation() {
  const { breaks, incompleteRows } = collectBreaks();
  const validation = validateBreaks(currentEmployee?.shiftType, breaks);
  const issues = [...incompleteRows.map((item) => item.message), ...validation.issues];
  return { breaks, incompleteRows, validation, issues, ok: incompleteRows.length === 0 && validation.ok };
}

function validationMessage(result) {
  const summary = `実働${result.validation.work}分 / 休憩${result.validation.actual}分 / 必要${result.validation.required}分`;
  return [summary, ...result.issues].join("\n");
}

function updatePreview() {
  if (!controls || !currentEmployee) return;
  const result = currentValidation();
  controls.preview.textContent = validationMessage(result);
  controls.preview.classList.toggle("break-edit-preview-warning", !result.ok);
  controls.saveButton.disabled = !result.ok;
}

function createDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "break-edit-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const header = document.createElement("div");
  header.className = "dialog-header";
  const title = document.createElement("h2");
  title.textContent = "休憩を編集";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "icon-button";
  closeButton.setAttribute("aria-label", "閉じる");
  closeButton.textContent = "×";
  header.append(title, closeButton);
  const subtitle = document.createElement("p");
  subtitle.className = "break-edit-subtitle";
  const list = document.createElement("div");
  list.className = "break-edit-list";
  const emptyHint = document.createElement("p");
  emptyHint.className = "break-edit-empty muted";
  emptyHint.textContent = "休憩が入力されていません。";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "button secondary";
  addButton.textContent = "＋ 休憩を追加";
  addButton.addEventListener("click", () => {
    list.append(createRow());
    updateEmptyHint();
    updatePreview();
  });
  const protect = document.createElement("input");
  protect.type = "checkbox";
  const protectLabel = labeledControl("自動再配置から保護", protect);
  protectLabel.classList.add("break-protect-field");
  const protectHelp = document.createElement("p");
  protectHelp.className = "muted";
  protectHelp.textContent = "オンにすると、シフト全体の休憩再配置を実行してもこの人の手動時刻を維持します。";
  const preview = document.createElement("p");
  preview.className = "break-edit-preview";
  preview.setAttribute("role", "status");
  preview.setAttribute("aria-live", "polite");
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "button secondary";
  cancelButton.textContent = "キャンセル";
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "button primary";
  saveButton.textContent = "保存";
  actions.append(spacer, cancelButton, saveButton);
  form.append(header, subtitle, list, emptyHint, addButton, protectLabel, protectHelp, preview, actions);
  dialog.append(form);
  document.body.append(dialog);
  closeButton.addEventListener("click", () => dialog.close());
  cancelButton.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentEmployee) return;
    const result = currentValidation();
    if (!result.ok) {
      updatePreview();
      result.incompleteRows[0]?.row._focusInvalid();
      setStatus(`休憩を保存できません: ${result.issues[0] ?? "入力内容を確認してください。"}`, true);
      return;
    }
    saveEmployeeBreaks({
      employeeId: currentEmployee.id,
      employeeName: currentEmployee.name,
      day: currentEmployee.day,
      dateValue: currentEmployee.dateValue,
      breaks: result.breaks,
      protectedFromAuto: protect.checked
    });
    dialog.close();
    setStatus(`${currentEmployee.name}さんの休憩を${result.breaks.length}件に更新しました`);
  });
  return { dialog, subtitle, list, emptyHint, preview, protect, saveButton };
}

export function initializeBreakEditUi(options = {}) {
  setStatus = options.setStatus ?? setStatus;
  if (!controls) controls = createDialog();
  return controls;
}

export function openBreakEditDialog({ employeeId, setStatus: setStatusOption } = {}) {
  initializeBreakEditUi({ setStatus: setStatusOption });
  const employee = state.employees.find((item) => item.id === employeeId);
  if (!employee) return;
  const dateValue = state.selectedDate;
  const day = dayFromDate(dateValue);
  const shiftCode = state.shifts[state.selectedMonth]?.[employeeId]?.[dateValue] ?? "";
  const shiftType = getShiftType(shiftCode);
  currentEmployee = { id: employee.id, name: employee.name, day, dateValue, shiftType };
  controls.subtitle.textContent = shiftType?.isWork
    ? `${employee.name}さん・${dateDisplayName(dateValue)}・${shiftType.name} ${shiftType.start}〜${shiftType.end}`
    : `${employee.name}さん・${dateDisplayName(dateValue)}`;
  const fragment = document.createDocumentFragment();
  for (const breakItem of getBreaks(employeeId, dateValue)) fragment.append(createRow(breakItem));
  controls.list.replaceChildren(fragment);
  controls.protect.checked = isManualBreakLockedInData(state.manualBreakLocks, dateValue, employeeId)
    || getBreaks(employeeId, dateValue).length === 0;
  updateEmptyHint();
  updatePreview();
  controls.dialog.showModal();
}
