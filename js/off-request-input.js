import {
  state,
  getShift,
  isShiftLocked,
  setShift,
  setShiftLock,
  scheduleSave,
  dateKey
} from "./model.js";
import { findDefaultDaysOffShiftCode } from "./auto-days-off.js";
import {
  getRequestedDayOffInData,
  setRequestedDayOffInData,
  removeRequestedDayOffInData
} from "./requested-days-off.js";
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

const requestState = { action: "apply", selectedCode: "" };
let controls = null;
let tableContainer = null;
let activeStroke = null;
let onStrokeComplete = () => {};
let setStatus = () => {};
let initialized = false;

function active() {
  return getMonthEditMode() === "off-request-paint";
}

function ensureSelectedCode() {
  const offTypes = state.shiftTypes.filter((shiftType) => !shiftType.isWork);
  if (offTypes.some((shiftType) => shiftType.code === requestState.selectedCode)) return;
  requestState.selectedCode = findDefaultDaysOffShiftCode(state.shiftTypes) || offTypes[0]?.code || "";
}

function shiftName(code) {
  return state.shiftTypes.find((shiftType) => shiftType.code === code)?.name ?? code;
}

function actionLabel(action = requestState.action) {
  return action === "release" ? "希望休解除" : `希望休（${shiftName(requestState.selectedCode)}）`;
}

function markerFor(employeeId, day) {
  const dateValue = dateKey(state.selectedMonth, day);
  return getRequestedDayOffInData(state.requestedDaysOff, state.selectedMonth, employeeId, dateValue);
}

function createControls() {
  const panel = document.createElement("section");
  panel.className = "off-request-panel";
  panel.setAttribute("aria-label", "希望休の入力");
  const heading = document.createElement("strong");
  heading.textContent = "希望休";
  const status = document.createElement("p");
  status.className = "off-request-status";
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "off-request-actions";
  const codeSelect = document.createElement("select");
  codeSelect.setAttribute("aria-label", "希望休として設定する休日区分");
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "button secondary";
  applyButton.textContent = "希望休を塗る";
  const releaseButton = document.createElement("button");
  releaseButton.type = "button";
  releaseButton.className = "button secondary";
  releaseButton.textContent = "希望休だけ解除";
  const normalButton = document.createElement("button");
  normalButton.type = "button";
  normalButton.className = "button secondary";
  normalButton.textContent = "通常入力に戻す";
  actions.append(codeSelect, applyButton, releaseButton, normalButton);
  panel.append(heading, status, actions);
  document.querySelector("#monthToolsSlot")?.append(panel);

  codeSelect.addEventListener("change", () => {
    requestState.selectedCode = codeSelect.value;
    syncOffRequestInput();
  });
  applyButton.addEventListener("click", () => {
    requestState.action = "apply";
    setMonthEditMode("off-request-paint");
  });
  releaseButton.addEventListener("click", () => {
    requestState.action = "release";
    setMonthEditMode("off-request-paint");
  });
  normalButton.addEventListener("click", () => setMonthEditMode("normal"));
  return { panel, status, codeSelect, applyButton, releaseButton, normalButton };
}

function renderCodeOptions() {
  ensureSelectedCode();
  const fragment = document.createDocumentFragment();
  for (const shiftType of state.shiftTypes) {
    if (shiftType.isWork) continue;
    const option = document.createElement("option");
    option.value = shiftType.code;
    option.textContent = shiftType.name;
    fragment.append(option);
  }
  controls.codeSelect.replaceChildren(fragment);
  controls.codeSelect.value = requestState.selectedCode;
  controls.codeSelect.disabled = requestState.action === "release";
}

function updateControls() {
  const applyActive = active() && requestState.action === "apply";
  const releaseActive = active() && requestState.action === "release";
  controls.applyButton.classList.toggle("primary", applyActive);
  controls.releaseButton.classList.toggle("primary", releaseActive);
  controls.normalButton.hidden = !active();
  controls.status.textContent = active()
    ? `セルをクリックまたはドラッグして${actionLabel()}します。`
    : "希望休は通常のセルロックとは別に記録されます。解除操作で通常ロックを外すことはありません。";
}

function updateCellVisual(cell) {
  const employeeId = cell.dataset.employeeId;
  const day = Number(cell.dataset.day);
  const locked = isShiftLocked(employeeId, day);
  const code = getShift(employeeId, day);
  const marker = markerFor(employeeId, day);
  const requested = Boolean(marker && locked && marker.shiftCode === code);
  cell.classList.toggle("shift-cell-locked", locked);
  cell.classList.toggle("requested-off-cell", requested);
  cell.dataset.locked = String(locked);
  cell.dataset.requestedOff = String(requested);
  const select = cell.querySelector(".shift-select");
  if (select) {
    select.value = code;
    select.disabled = locked;
    select.setAttribute("aria-disabled", String(locked));
  }
  const button = cell.querySelector(".cell-lock-button");
  if (button) {
    button.textContent = locked ? "■" : "□";
    button.setAttribute("aria-pressed", String(locked));
  }
}

function applyToCell(cell) {
  const employeeId = cell.dataset.employeeId;
  const day = Number(cell.dataset.day);
  if (!employeeId || !Number.isInteger(day)) return false;
  const dateValue = dateKey(state.selectedMonth, day);
  state.requestedDaysOff ??= {};

  if (requestState.action === "release") {
    if (!markerFor(employeeId, day)) return false;
    removeRequestedDayOffInData(state.requestedDaysOff, state.selectedMonth, employeeId, dateValue);
    setShiftLock(employeeId, day, false, { save: false });
    updateCellVisual(cell);
    return true;
  }

  const code = requestState.selectedCode;
  if (!code) return false;
  const marker = markerFor(employeeId, day);
  if (marker?.shiftCode === code && getShift(employeeId, day) === code && isShiftLocked(employeeId, day)) return false;
  setShift(employeeId, day, code, { save: false });
  setShiftLock(employeeId, day, true, { save: false });
  setRequestedDayOffInData(state.requestedDaysOff, state.selectedMonth, employeeId, dateValue, code);
  updateCellVisual(cell);
  return true;
}

function cellAtPointer(event) {
  return document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".shift-lock-cell") ?? null;
}

function visitCell(cell) {
  if (!activeStroke || !cell || !tableContainer.contains(cell)) return;
  activeStroke.stroke.visit(`${cell.dataset.employeeId}:${cell.dataset.day}`, cell);
}

function beginStroke(event, cell) {
  if (!active() || activeStroke || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  const action = requestState.action;
  activeStroke = {
    pointerId: event.pointerId,
    action,
    transaction: beginHistoryTransaction(action === "release" ? "希望休の解除" : actionLabel(action)),
    stroke: createPaintStroke(applyToCell)
  };
  try { tableContainer.setPointerCapture(event.pointerId); } catch { /* optional */ }
  visitCell(cell);
}

function finishStroke(event) {
  if (!activeStroke || (event?.pointerId !== undefined && event.pointerId !== activeStroke.pointerId)) return;
  const finished = activeStroke;
  activeStroke = null;
  const summary = finished.stroke.summary();
  if (summary.changedCount > 0) {
    scheduleSave();
    commitHistoryTransaction(finished.transaction);
    onStrokeComplete();
    setStatus(`${summary.changedCount}セルへ${actionLabel(finished.action)}を適用しました`);
  } else {
    cancelHistoryTransaction(finished.transaction);
  }
}

function applyKeyboardRequest(event) {
  if (!active() || !["Enter", " "].includes(event.key)) return;
  const cell = event.target.closest(".shift-lock-cell");
  if (!cell) return;
  event.preventDefault();
  const transaction = beginHistoryTransaction(requestState.action === "release" ? "希望休の解除" : actionLabel());
  if (applyToCell(cell)) {
    scheduleSave();
    commitHistoryTransaction(transaction);
    onStrokeComplete();
    setStatus(`1セルへ${actionLabel()}を適用しました`);
  } else {
    cancelHistoryTransaction(transaction);
  }
}

export function initializeOffRequestInput(options) {
  if (initialized) return;
  initialized = true;
  tableContainer = options.tableContainer;
  onStrokeComplete = options.onStrokeComplete ?? onStrokeComplete;
  setStatus = options.setStatus ?? setStatus;
  controls = createControls();
  tableContainer.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest(".shift-lock-cell");
    if (cell) beginStroke(event, cell);
  });
  tableContainer.addEventListener("pointermove", (event) => {
    if (!activeStroke || event.pointerId !== activeStroke.pointerId) return;
    event.preventDefault();
    visitCell(cellAtPointer(event));
  });
  tableContainer.addEventListener("pointerup", finishStroke);
  tableContainer.addEventListener("pointercancel", finishStroke);
  tableContainer.addEventListener("lostpointercapture", finishStroke);
  tableContainer.addEventListener("keydown", applyKeyboardRequest);
  globalThis.addEventListener("blur", () => finishStroke());
  subscribeMonthEditMode(syncOffRequestInput);
  new MutationObserver(syncOffRequestInput).observe(tableContainer, { childList: true });
  syncOffRequestInput();
}

export function syncOffRequestInput() {
  if (!controls) return;
  renderCodeOptions();
  updateControls();
  tableContainer.classList.toggle("off-request-mode", active());
}
