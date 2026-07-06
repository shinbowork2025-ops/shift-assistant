import {
  state,
  getShift,
  isShiftLocked,
  setShift,
  setShiftLock,
  scheduleSave
} from "./model.js";
import { findDefaultDaysOffShiftCode } from "./auto-days-off.js";
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

// 「希望休」は非勤務のシフト区分をセルへ設定した上でロックする操作。
// ロック済みセルは公休自動配置・勤務自動割当・月間ソルバーのいずれからも
// 変更されないため、これだけで全ての自動作成が希望休を尊重する。
const requestState = {
  action: "apply", // "apply" | "release"
  selectedCode: ""
};

let controls = null;
let tableContainer = null;
let activeStroke = null;
let onStrokeComplete = () => {};
let setStatus = () => {};
let initialized = false;

function active() {
  return getMonthEditMode() === "off-request-paint";
}

function selectedCode() {
  return requestState.selectedCode;
}

function ensureSelectedCode() {
  const options = state.shiftTypes.filter((shiftType) => !shiftType.isWork);
  if (options.some((shiftType) => shiftType.code === requestState.selectedCode)) return;
  requestState.selectedCode = findDefaultDaysOffShiftCode(state.shiftTypes) || options[0]?.code || "";
}

function shiftName(code) {
  return state.shiftTypes.find((shiftType) => shiftType.code === code)?.name ?? code;
}

function actionLabel(action = requestState.action) {
  return action === "release" ? "希望休解除" : `希望休（${shiftName(selectedCode())}）`;
}

function historyLabel(action = requestState.action) {
  return action === "release" ? "希望休の解除" : `希望休：${shiftName(selectedCode())}`;
}

function loadStylesheet() {
  if (document.querySelector('link[href="./off-request.css"]')) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "./off-request.css";
  document.head.append(stylesheet);
}

function createControls() {
  const panel = document.createElement("section");
  panel.className = "off-request-panel";
  panel.setAttribute("aria-label", "希望休の入力");

  const headingArea = document.createElement("div");
  headingArea.className = "off-request-heading";
  const heading = document.createElement("strong");
  heading.textContent = "希望休";
  const status = document.createElement("p");
  status.className = "off-request-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  headingArea.append(heading, status);

  const actions = document.createElement("div");
  actions.className = "off-request-actions";
  const codeSelect = document.createElement("select");
  codeSelect.className = "off-request-code-select";
  codeSelect.setAttribute("aria-label", "希望休として設定する区分");
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "button secondary off-request-mode-button";
  applyButton.textContent = "希望休を塗る";
  const releaseButton = document.createElement("button");
  releaseButton.type = "button";
  releaseButton.className = "button secondary off-request-mode-button";
  releaseButton.textContent = "希望休解除を塗る";
  const normalButton = document.createElement("button");
  normalButton.type = "button";
  normalButton.className = "button secondary";
  normalButton.textContent = "通常入力に戻す";
  actions.append(codeSelect, applyButton, releaseButton, normalButton);
  panel.append(headingArea, actions);

  const slot = document.querySelector("#monthToolsSlot");
  const lockPanel = document.querySelector(".lock-panel");
  const paintPanel = document.querySelector(".paint-panel");
  const scheduleHeading = document.querySelector("#monthPanel .schedule-heading");
  if (slot) slot.append(panel);
  else if (lockPanel) lockPanel.insertAdjacentElement("afterend", panel);
  else if (paintPanel) paintPanel.insertAdjacentElement("afterend", panel);
  else scheduleHeading?.insertAdjacentElement("afterend", panel);

  codeSelect.addEventListener("change", () => {
    requestState.selectedCode = codeSelect.value;
    syncOffRequestInput();
  });
  applyButton.addEventListener("click", () => {
    requestState.action = "apply";
    setMonthEditMode("off-request-paint");
    syncOffRequestInput();
  });
  releaseButton.addEventListener("click", () => {
    requestState.action = "release";
    setMonthEditMode("off-request-paint");
    syncOffRequestInput();
  });
  normalButton.addEventListener("click", () => setMonthEditMode("normal"));

  return { panel, status, codeSelect, applyButton, releaseButton, normalButton };
}

function renderCodeOptions() {
  if (!controls) return;
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
  if (!controls) return;
  const isApplyMode = active() && requestState.action === "apply";
  const isReleaseMode = active() && requestState.action === "release";
  controls.applyButton.classList.toggle("primary", isApplyMode);
  controls.applyButton.classList.toggle("secondary", !isApplyMode);
  controls.releaseButton.classList.toggle("primary", isReleaseMode);
  controls.releaseButton.classList.toggle("secondary", !isReleaseMode);
  controls.normalButton.hidden = !active();
  controls.status.textContent = active()
    ? `セルをクリックまたはドラッグして${actionLabel()}を適用します。`
    : "セルへ休日区分を設定し、自動でロックします。公休自動配置・勤務自動割当・月間ソルバーはロック済みセルを変更しません。解除するにはこのパネルの「希望休解除を塗る」を使用してください。";
}

function updateTableMode() {
  if (!tableContainer) return;
  tableContainer.classList.toggle("off-request-mode", active());
}

function updateCellVisual(cell) {
  const employeeId = cell.dataset.employeeId;
  const day = Number(cell.dataset.day);
  const locked = isShiftLocked(employeeId, day);
  const code = getShift(employeeId, day);
  const shiftType = state.shiftTypes.find((item) => item.code === code) ?? null;
  const isRequestedOff = locked && Boolean(shiftType) && !shiftType.isWork;
  cell.classList.toggle("shift-cell-locked", locked);
  cell.classList.toggle("requested-off-cell", isRequestedOff);
  cell.dataset.locked = String(locked);
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
  cell.classList.add("off-request-cell-touched");
}

function applyToCell(cell) {
  const employeeId = cell.dataset.employeeId;
  const day = Number(cell.dataset.day);
  if (!employeeId || !Number.isInteger(day)) return false;

  if (requestState.action === "release") {
    if (!isShiftLocked(employeeId, day)) return false;
    setShiftLock(employeeId, day, false, { save: false });
    updateCellVisual(cell);
    return true;
  }

  const code = selectedCode();
  if (!code) return false;
  const alreadyRequested = getShift(employeeId, day) === code && isShiftLocked(employeeId, day);
  if (alreadyRequested) return false;
  setShift(employeeId, day, code, { save: false });
  setShiftLock(employeeId, day, true, { save: false });
  updateCellVisual(cell);
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
  return document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".shift-lock-cell") ?? null;
}

function beginStroke(event, cell) {
  if (!active() || activeStroke) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  const action = requestState.action;
  activeStroke = {
    pointerId: event.pointerId,
    action,
    transaction: beginHistoryTransaction(historyLabel(action)),
    stroke: createPaintStroke((targetCell) => applyToCell(targetCell))
  };
  tableContainer.classList.add("off-request-stroke-active");
  document.body.classList.add("off-request-dragging");
  try {
    tableContainer.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is optional.
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
  tableContainer.classList.remove("off-request-stroke-active");
  document.body.classList.remove("off-request-dragging");
  try {
    if (tableContainer.hasPointerCapture(finished.pointerId)) tableContainer.releasePointerCapture(finished.pointerId);
  } catch {
    // The browser may already have released the pointer.
  }

  const summary = finished.stroke.summary();
  if (summary.changedCount > 0) {
    scheduleSave();
    commitHistoryTransaction(finished.transaction);
    onStrokeComplete();
    setStatus(`${summary.changedCount}セルへ${actionLabel(finished.action)}を適用しました`);
  } else {
    cancelHistoryTransaction(finished.transaction);
    syncOffRequestInput();
  }
}

function applyKeyboardRequest(event) {
  if (!active() || !["Enter", " "].includes(event.key)) return;
  const cell = event.target.closest(".shift-lock-cell");
  if (!cell) return;
  event.preventDefault();
  const action = requestState.action;
  const transaction = beginHistoryTransaction(historyLabel(action));
  const changed = applyToCell(cell);
  if (changed) {
    scheduleSave();
    commitHistoryTransaction(transaction);
    onStrokeComplete();
    setStatus(`1セルへ${actionLabel(action)}を適用しました`);
  } else {
    cancelHistoryTransaction(transaction);
  }
}

export function initializeOffRequestInput(options) {
  if (initialized) return;
  initialized = true;
  loadStylesheet();
  tableContainer = options.tableContainer;
  onStrokeComplete = options.onStrokeComplete ?? onStrokeComplete;
  setStatus = options.setStatus ?? setStatus;
  controls = createControls();

  tableContainer.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest(".shift-lock-cell");
    if (cell) beginStroke(event, cell);
  });
  tableContainer.addEventListener("pointermove", moveStroke);
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
  updateTableMode();
}
