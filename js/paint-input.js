import {
  state,
  getShift,
  getShiftType,
  isShiftLocked,
  setShift,
  dateKey,
  scheduleSave
} from "./model.js";
import { generateBreaksForDate } from "./breaks.js";
import { shiftToneClass } from "./render-common.js";
import {
  beginHistoryTransaction,
  commitHistoryTransaction,
  cancelHistoryTransaction
} from "./history.js";
import { createPaintStroke } from "./paint-stroke.js";
import {
  getMonthEditMode,
  setMonthEditMode,
  subscribeMonthEditMode
} from "./month-edit-mode.js";

const paintState = {
  selectedShiftCode: null
};

let controls = null;
let tableContainer = null;
let activeStroke = null;
let onStrokeComplete = () => {};
let setStatus = () => {};

function active() {
  return getMonthEditMode() === "shift-paint";
}

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

  // レイアウトはindex.htmlのスロットが決める。スロットがない旧構造でも動くよう
  // 見出し直後への挿入をフォールバックとして残す。
  const slot = document.querySelector("#monthToolsSlot");
  if (slot) slot.append(panel);
  else document.querySelector("#monthPanel .schedule-heading")?.insertAdjacentElement("afterend", panel);

  toggleButton.addEventListener("click", () => {
    setMonthEditMode(active() ? "normal" : "shift-paint");
  });
  palette.addEventListener("click", (event) => {
    const button = event.target.closest(".paint-palette-button");
    if (!button) return;
    paintState.selectedShiftCode = button.dataset.shiftCode ?? "";
    setMonthEditMode("shift-paint");
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
  controls.toggleButton.textContent = active() ? "通常入力に戻す" : "ペイントを開始";
  controls.toggleButton.classList.toggle("primary", active());
  controls.toggleButton.classList.toggle("secondary", !active());
  controls.toggleButton.setAttribute("aria-pressed", String(active()));
  controls.status.textContent = active()
    ? `「${paintActionLabel()}」をクリックまたはドラッグして連続入力します。ロック済みセルは変更しません。`
    : "OFF：通常のプルダウン入力です。シフトの色を選ぶとペイントを開始します。";
}

function updateTableMode() {
  if (!tableContainer) return;
  const mode = getMonthEditMode();
  tableContainer.classList.toggle("paint-mode", mode === "shift-paint");
  const employeeNames = new Map(state.employees.map((employee) => [employee.id, employee.name]));
  const shiftNames = new Map(state.shiftTypes.map((shiftType) => [shiftType.code, shiftType.name]));
  const cells = tableContainer.querySelectorAll(".paint-cell");
  cells.forEach((cell) => {
    cell.tabIndex = mode === "shift-paint" || mode === "lock-paint" ? 0 : -1;
    if (mode === "shift-paint") cell.setAttribute("role", "button");
    const employeeName = employeeNames.get(cell.dataset.employeeId) ?? "従業員";
    const currentCode = getShift(cell.dataset.employeeId, Number(cell.dataset.day));
    const currentShift = currentCode ? shiftNames.get(currentCode) ?? currentCode : "未入力";
    const locked = isShiftLocked(cell.dataset.employeeId, Number(cell.dataset.day));
    cell.setAttribute(
      "aria-label",
      mode === "shift-paint"
        ? `${employeeName} ${cell.dataset.day}日。現在${currentShift}。${locked ? "ロック済み" : `${paintActionLabel()}を適用`}`
        : `${employeeName} ${cell.dataset.day}日のシフト${locked ? "、ロック済み" : ""}`
    );
  });
  tableContainer.querySelectorAll(".shift-select").forEach((select) => {
    select.tabIndex = mode === "normal" && !select.disabled ? 0 : -1;
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

function recordChangedCell(changesByDate, employeeId, day) {
  const changedDate = dateKey(state.selectedMonth, day);
  if (!changesByDate.has(changedDate)) changesByDate.set(changedDate, new Set());
  changesByDate.get(changedDate).add(employeeId);
}

function applyPaintToCell(cell, shiftCode, changesByDate, stats) {
  const employeeId = cell.dataset.employeeId;
  const day = Number(cell.dataset.day);
  if (!employeeId || !Number.isInteger(day)) return false;
  if (isShiftLocked(employeeId, day)) {
    stats.lockedSkipped += 1;
    return false;
  }
  if (getShift(employeeId, day) === shiftCode) return false;

  const changed = setShift(employeeId, day, shiftCode, { save: false, respectLock: true });
  if (!changed) return false;
  recordChangedCell(changesByDate, employeeId, day);
  updateCellVisual(cell, shiftCode);
  return true;
}

function finalizePaintChanges(changesByDate) {
  for (const [changedDate, employeeIds] of changesByDate) {
    generateBreaksForDate(changedDate, [...employeeIds], { save: false });
  }
  scheduleSave();
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
  if (!active() || activeStroke || event.target.closest(".cell-lock-button")) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();

  const shiftCode = selectedCode();
  const changesByDate = new Map();
  const stats = { lockedSkipped: 0 };
  activeStroke = {
    pointerId: event.pointerId,
    shiftCode,
    changesByDate,
    stats,
    transaction: beginHistoryTransaction(historyLabel(shiftCode)),
    stroke: createPaintStroke((targetCell) => applyPaintToCell(targetCell, shiftCode, changesByDate, stats))
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
    finalizePaintChanges(finished.changesByDate);
    commitHistoryTransaction(finished.transaction);
    onStrokeComplete();
    const skipped = finished.stats.lockedSkipped > 0 ? `、ロック済み${finished.stats.lockedSkipped}セルは維持` : "";
    setStatus(`${summary.changedCount}セルへ「${paintActionLabel(finished.shiftCode)}」を適用しました${skipped}`);
  } else {
    cancelHistoryTransaction(finished.transaction);
    syncPaintInput();
    if (finished.stats.lockedSkipped > 0) setStatus(`ロック済み${finished.stats.lockedSkipped}セルは変更しませんでした`);
  }
}

function applyKeyboardPaint(event) {
  if (!active() || !["Enter", " "].includes(event.key)) return;
  const cell = event.target.closest(".paint-cell");
  if (!cell) return;
  event.preventDefault();

  const shiftCode = selectedCode();
  const changesByDate = new Map();
  const stats = { lockedSkipped: 0 };
  const transaction = beginHistoryTransaction(historyLabel(shiftCode));
  const changed = applyPaintToCell(cell, shiftCode, changesByDate, stats);
  if (changed) {
    finalizePaintChanges(changesByDate);
    commitHistoryTransaction(transaction);
    onStrokeComplete();
    setStatus(`1セルへ「${paintActionLabel(shiftCode)}」を適用しました`);
  } else {
    cancelHistoryTransaction(transaction);
    if (stats.lockedSkipped > 0) setStatus("ロック済みセルは変更できません");
  }
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
  subscribeMonthEditMode(syncPaintInput);
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
  if (active()) setMonthEditMode("normal");
}
