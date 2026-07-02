import {
  state,
  getShift,
  getShiftType,
  setShift,
  dateKey
} from "./model.js";
import { generateBreaksForDate } from "./breaks.js";
import { shiftToneClass } from "./render-common.js";
import {
  beginHistoryTransaction,
  commitHistoryTransaction,
  cancelHistoryTransaction,
  runWithHistory
} from "./history.js";
import { createPaintStroke } from "./paint-stroke.js";

const paintState = {
  enabled: false,
  selectedShiftCode: null
};

let controls = null;
let tableContainer = null;
let activeStroke = null;
let onStrokeComplete = () => {};
let setStatus = () => {};

function selectedCode() {
  return paintState.selectedShiftCode ?? "";
}

function ensureSelectedShift() {
  if (paintState.selectedShiftCode === "") return;
  const exists = state.shiftTypes.some((shift) => shift.code === paintState.selectedShiftCode);
  if (!exists) paintState.selectedShiftCode = state.shiftTypes[0]?.code ?? "";
}

function shiftName(code) {
  if (!code) return "未入力";
  return getShiftType(code)?.name ?? code;
}

function paintActionLabel(code = selectedCode()) {
  return code ? shiftName(code) : "消去";
}

function historyLabel(code = selectedCode()) {
  return `ペイント入力：${paintActionLabel(code)}`;
}

function createControls() {
  const panel = document.createElement("section");
  panel.className = "paint-panel";
  panel.setAttribute("aria-label", "ペイント入力");

  const headingArea = document.createElement("div");
  headingArea.className = "paint-heading";
  const heading = document.createElement("strong");
  heading.textContent = "ペイント入力";
  const status = document.createElement("p");
  status.className = "paint-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  headingArea.append(heading, status);

  const actionArea = document.createElement("div");
  actionArea.className = "paint-actions";
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "button secondary paint-toggle-button";
  toggleButton.setAttribute("aria-pressed", "false");
  const palette = document.createElement("div");
  palette.className = "paint-palette";
  palette.setAttribute("role", "group");
  palette.setAttribute("aria-label", "塗るシフトを選択");
  actionArea.append(toggleButton, palette);
  panel.append(headingArea, actionArea);

  const scheduleHeading = document.querySelector("#monthPanel .schedule-heading");
  scheduleHeading?.insertAdjacentElement("afterend", panel);

  toggleButton.addEventListener("click", () => {
    setPaintEnabled(!paintState.enabled);
  });
  palette.addEventListener("click", (event) => {
    const button = event.target.closest(".paint-palette-button");
    if (!button) return;
    paintState.selectedShiftCode = button.dataset.shiftCode ?? "";
    paintState.enabled = true;
    syncPaintInput();
  });

  return { panel, status, toggleButton, palette };
}

function renderPalette() {
  if (!controls) return;
  ensureSelectedShift();
  const fragment = document.createDocumentFragment();

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "paint-palette-button paint-clear-button";
  clearButton.dataset.shiftCode = "";
  clearButton.textContent = "消去";
  clearButton.title = "入力済みシフトを未入力へ戻す";
  clearButton.setAttribute("aria-pressed", String(selectedCode() === ""));
  clearButton.classList.toggle("selected", selectedCode() === "");
  fragment.append(clearButton);

  state.shiftTypes.forEach((shiftType) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `paint-palette-button ${shiftToneClass(shiftType.code)}`;
    button.dataset.shiftCode = shiftType.code;
    button.textContent = shiftType.shortLabel || shiftType.name;
    button.title = shiftType.isWork
      ? `${shiftType.name} ${shiftType.start}〜${shiftType.end}`
      : shiftType.name;
    const selected = selectedCode() === shiftType.code;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    fragment.append(button);
  });

  controls.palette.replaceChildren(fragment);
}

function updateControls() {
  if (!controls) return;
  controls.toggleButton.textContent = paintState.enabled ? "通常入力に戻す" : "ペイントを開始";
  controls.toggleButton.classList.toggle("primary", paintState.enabled);
  controls.toggleButton.classList.toggle("secondary", !paintState.enabled);
  controls.toggleButton.setAttribute("aria-pressed", String(paintState.enabled));
  controls.status.textContent = paintState.enabled
    ? `「${paintActionLabel()}」をクリックまたはドラッグして連続入力します。`
    : "OFF：通常のプルダウン入力です。シフトの色を選ぶとペイントを開始します。";
}

function updateTableMode() {
  if (!tableContainer) return;
  tableContainer.classList.toggle("paint-mode", paintState.enabled);
  const cells = tableContainer.querySelectorAll(".paint-cell");
  cells.forEach((cell) => {
    cell.tabIndex = paintState.enabled ? 0 : -1;
    cell.setAttribute("role", paintState.enabled ? "button" : "cell");
    const employeeName = state.employees.find((employee) => employee.id === cell.dataset.employeeId)?.name ?? "従業員";
    const currentShift = shiftName(getShift(cell.dataset.employeeId, Number(cell.dataset.day)));
    cell.setAttribute(
      "aria-label",
      paintState.enabled
        ? `${employeeName} ${cell.dataset.day}日。現在${currentShift}。${paintActionLabel()}を適用`
        : `${employeeName} ${cell.dataset.day}日のシフト`
    );
  });
  tableContainer.querySelectorAll(".shift-select").forEach((select) => {
    select.tabIndex = paintState.enabled ? -1 : 0;
  });
}

function removeToneClasses(element) {
  [...element.classList]
    .filter((className) => /^shift-tone-\d+$/.test(className))
    .forEach((className) => element.classList.remove(className));
}

function updateCellVisual(cell, shiftCode) {
  const select = cell.querySelector(".shift-select");
  if (!select) return;
  select.value = shiftCode;
  select.dataset.shift = shiftCode;
  removeToneClasses(select);
  const toneClass = shiftToneClass(shiftCode);
  if (toneClass) select.classList.add(toneClass);
  cell.classList.add("paint-cell-touched");
}

function applyPaintToCell(cell, shiftCode) {
  const employeeId = cell.dataset.employeeId;
  const day = Number(cell.dataset.day);
  if (!employeeId || !Number.isInteger(day)) return false;
  if (getShift(employeeId, day) === shiftCode) return false;

  setShift(employeeId, day, shiftCode);
  generateBreaksForDate(dateKey(state.selectedMonth, day), [employeeId]);
  updateCellVisual(cell, shiftCode);
  return true;
}

function cellKey(cell) {
  return `${cell.dataset.employeeId}:${cell.dataset.day}`;
}

function visitCell(cell) {
  if (!activeStroke || !cell || !tableContainer.contains(cell)) return;
  activeStroke.stroke.visit(cellKey(cell), cell);
}

function cellAtPointer(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  return element?.closest?.(".paint-cell") ?? null;
}

function beginStroke(event, cell) {
  if (!paintState.enabled || activeStroke) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();

  const shiftCode = selectedCode();
  activeStroke = {
    pointerId: event.pointerId,
    shiftCode,
    transaction: beginHistoryTransaction(historyLabel(shiftCode)),
    stroke: createPaintStroke((targetCell) => applyPaintToCell(targetCell, shiftCode))
  };
  tableContainer.classList.add("paint-stroke-active");
  document.body.classList.add("paint-dragging");
  try {
    tableContainer.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is optional. elementFromPoint still supports the stroke.
  }
  visitCell(cell);
}

function moveStroke(event) {
  if (!activeStroke || event.pointerId !== activeStroke.pointerId) return;
  event.preventDefault();
  visitCell(cellAtPointer(event));
}

function finishStroke(event) {
  if (!activeStroke || (event?.pointerId !== undefined && event.pointerId !== activeStroke.pointerId)) return;
  const finished = activeStroke;
  activeStroke = null;
  tableContainer.classList.remove("paint-stroke-active");
  document.body.classList.remove("paint-dragging");
  try {
    if (tableContainer.hasPointerCapture(finished.pointerId)) tableContainer.releasePointerCapture(finished.pointerId);
  } catch {
    // The pointer may already have been released by the browser.
  }

  const summary = finished.stroke.summary();
  if (summary.changedCount > 0) {
    commitHistoryTransaction(finished.transaction);
    onStrokeComplete();
    setStatus(`${summary.changedCount}セルへ「${paintActionLabel(finished.shiftCode)}」を適用しました`);
  } else {
    cancelHistoryTransaction(finished.transaction);
    syncPaintInput();
  }
}

function applyKeyboardPaint(event) {
  if (!paintState.enabled || !["Enter", " "].includes(event.key)) return;
  const cell = event.target.closest(".paint-cell");
  if (!cell) return;
  event.preventDefault();
  const shiftCode = selectedCode();
  let changed = false;
  runWithHistory(historyLabel(shiftCode), () => {
    changed = applyPaintToCell(cell, shiftCode);
  });
  if (changed) {
    onStrokeComplete();
    setStatus(`1セルへ「${paintActionLabel(shiftCode)}」を適用しました`);
  }
}

function setPaintEnabled(enabled) {
  if (activeStroke) finishStroke();
  paintState.enabled = Boolean(enabled);
  syncPaintInput();
}

export function initializePaintInput(options) {
  tableContainer = options.tableContainer;
  onStrokeComplete = options.onStrokeComplete ?? onStrokeComplete;
  setStatus = options.setStatus ?? setStatus;
  controls = createControls();

  tableContainer.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest(".paint-cell");
    if (cell) beginStroke(event, cell);
  });
  tableContainer.addEventListener("pointermove", moveStroke);
  tableContainer.addEventListener("pointerup", finishStroke);
  tableContainer.addEventListener("pointercancel", finishStroke);
  tableContainer.addEventListener("lostpointercapture", finishStroke);
  tableContainer.addEventListener("keydown", applyKeyboardPaint);
  globalThis.addEventListener("blur", () => finishStroke());
  syncPaintInput();
}

export function syncPaintInput() {
  if (!controls) return;
  ensureSelectedShift();
  renderPalette();
  updateControls();
  updateTableMode();
}

export function disablePaintInput() {
  setPaintEnabled(false);
}
