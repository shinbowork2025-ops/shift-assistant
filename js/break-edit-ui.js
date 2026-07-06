import { state, getShiftType, getBreaks, dayFromDate, dateDisplayName } from "./model.js";
import { validateBreaks } from "./break-rules.js";
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

// 15分単位に丸める。手入力やブラウザの挙動でグリッドから外れても、
// 自動配置と同じ粒度で保存し、時間帯チャートの表示を一致させる。
function roundToQuarterHour(value) {
  if (!/^\d{1,2}:\d{2}$/.test(value)) return value;
  const [hours, minutes] = value.split(":").map(Number);
  const total = hours * 60 + minutes;
  const rounded = Math.round(total / 15) * 15;
  const normalized = ((rounded % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function createRow(breakItem = {}) {
  const row = document.createElement("div");
  row.className = "break-edit-row";

  const type = document.createElement("select");
  const smallOption = document.createElement("option");
  smallOption.value = "small";
  smallOption.textContent = "小休憩";
  const lunchOption = document.createElement("option");
  lunchOption.value = "lunch";
  lunchOption.textContent = "昼休憩";
  type.append(smallOption, lunchOption);
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

  for (const control of [type, start, end]) {
    control.addEventListener("change", updatePreview);
  }

  row.append(
    labeledControl("種類", type),
    labeledControl("開始", start),
    labeledControl("終了", end),
    removeButton
  );
  row._readBreak = () => ({
    type: type.value,
    label: type.value === "lunch" ? "昼休憩" : "小休憩",
    start: start.value ? roundToQuarterHour(start.value) : "",
    end: end.value ? roundToQuarterHour(end.value) : ""
  });
  return row;
}

function updateEmptyHint() {
  if (!controls) return;
  controls.emptyHint.hidden = Boolean(controls.list.querySelector(".break-edit-row"));
}

function collectBreaks() {
  return [...controls.list.querySelectorAll(".break-edit-row")]
    .map((row) => row._readBreak())
    .filter((item) => item.start && item.end);
}

function validationMessage(validation) {
  const summary = `実働${validation.work}分 / 休憩${validation.actual}分 / 必要${validation.required}分`;
  return [summary, ...validation.issues].join("\n");
}

function updatePreview() {
  if (!controls || !currentEmployee) return;
  const breaks = collectBreaks();
  const validation = validateBreaks(currentEmployee.shiftType, breaks);
  controls.preview.textContent = validationMessage(validation);
  controls.preview.classList.toggle("break-edit-preview-warning", !validation.ok);
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
    controls.list.append(createRow());
    updateEmptyHint();
    updatePreview();
  });

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

  form.append(header, subtitle, list, emptyHint, addButton, preview, actions);
  dialog.append(form);
  document.body.append(dialog);

  closeButton.addEventListener("click", () => dialog.close());
  cancelButton.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentEmployee) return;
    const breaks = collectBreaks();
    saveEmployeeBreaks({
      employeeId: currentEmployee.id,
      employeeName: currentEmployee.name,
      day: currentEmployee.day,
      dateValue: currentEmployee.dateValue,
      breaks
    });
    dialog.close();
    setStatus(breaks.length
      ? `${currentEmployee.name}さんの休憩を${breaks.length}件に更新しました`
      : `${currentEmployee.name}さんの休憩をすべて削除しました`);
  });

  return { dialog, subtitle, list, emptyHint, preview };
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

  const existingBreaks = getBreaks(employeeId, dateValue);
  const fragment = document.createDocumentFragment();
  for (const breakItem of existingBreaks) fragment.append(createRow(breakItem));
  controls.list.replaceChildren(fragment);
  updateEmptyHint();
  updatePreview();
  controls.dialog.showModal();
}
