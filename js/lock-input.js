import {
  state,
  isShiftLocked,
  setShiftLock,
  scheduleSave
} from "./model.js";
import {
  beginHistoryTransaction,
  commitHistoryTransaction,
  cancelHistoryTransaction,
  runWithHistory
} from "./history.js";
import { createPaintStroke } from "./paint-stroke.js";
import {
  getMonthEditMode,
  setMonthEditMode,
  subscribeMonthEditMode
} from "./month-edit-mode.js";

const lockState = {
  targetLocked: true
};

let controls = null;
let tableContainer = null;
let activeStroke = null;
let onStrokeComplete = () => {};
let setStatus = () => {};
let initialized = false;

function active() {
  return getMonthEditMode() === "lock-paint";
}

function actionLabel(locked = lockState.targetLocked) {
  return locked ? "ロック" : "ロック解除";
}

function historyLabel(locked = lockState.targetLocked) {
  return `セル${actionLabel(locked)}`;
}

function loadStylesheet() {
  if (document.querySelector('link[href="./lock.css"]')) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "./lock.css";
  document.head.append(stylesheet);
}

function createControls() {
  const panel = document.createElement("section");
  panel.className = "lock-panel";
  panel.setAttribute("aria-label", "シフトセルのロック");

  const headingArea = document.createElement("div");
  headingArea.className = "lock-heading";
  const heading = document.createElement("strong");
  heading.textContent = "セルロック";
  const status = document.createElement("p");
  status.className = "lock-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  headingArea.append(heading, status);

  const actions = document.createElement("div");
  actions.className = "lock-actions";
  const lockButton = document.createElement("button");
  lockButton.type = "button";
  lockButton.className = "button secondary lock-mode-button";
  lockButton.textContent = "ロックを塗る";
  const unlockButton = document.createElement("button");
  unlockButton.type = "button";
  unlockButton.className = "button secondary lock-mode-button";
  unlockButton.textContent = "解除を塗る";
  const normalButton = document.createElement("button");
  normalButton.type = "button";
  normalButton.className = "button secondary";
  normalButton.textContent = "通常入力に戻す";
  actions.append(lockButton, unlockButton, normalButton);
  panel.append(headingArea, actions);

  const paintPanel = document.querySelector(".paint-panel");
  const scheduleHeading = document.querySelector("#monthPanel .schedule-heading");
  if (paintPanel) paintPanel.insertAdjacentElement("afterend", panel);
  else scheduleHeading?.insertAdjacentElement("afterend", panel);

  lockButton.addEventListener("click", () => {
    lockState.targetLocked = true;
    setMonthEditMode("lock-paint");
    syncLockInput();
  });
  unlockButton.addEventListener("click", () => {
    lockState.targetLocked = false;
    setMonthEditMode("lock-paint");
    syncLockInput();
  });
  normalButton.addEventListener("click", () => setMonthEditMode("normal"));

  return { panel, status, lockButton, unlockButton, normalButton };
}

function updateControls() {
  if (!controls) return;
  controls.lockButton.classList.toggle("primary", active() && lockState.targetLocked);
  controls.lockButton.classList.toggle("secondary", !active() || !lockState.targetLocked);
  controls.unlockButton.classList.toggle("primary", active() && !lockState.targetLocked);
  controls.unlockButton.classList.toggle("secondary", !active() || lockState.targetLocked);
  controls.normalButton.hidden = !active();
  controls.status.textContent = active()
    ? `セルをクリックまたはドラッグして${actionLabel()}します。空欄セルも保護できます。`
    : "各セル右上の四角で個別切替できます。複数セルはロック／解除を塗って操作します。";
}

function updateTableMode() {
  if (!tableContainer) return;
  const mode = getMonthEditMode();
  tableContainer.classList.toggle("lock-mode", mode === "lock-paint");
  tableContainer.querySelectorAll(".shift-lock-cell").forEach((cell) => {
    cell.tabIndex = mode === "lock-paint" || mode === "shift-paint" ? 0 : -1;
    if (mode === "lock-paint") cell.setAttribute("role", "button");
  });
}

function updateCellVisual(cell, locked) {
  cell.dataset.locked = String(locked);
  cell.classList.toggle("shift-cell-locked", locked);
  cell.classList.add("lock-cell-touched");
  const select = cell.querySelector(".shift-select");
  if (select) {
    select.disabled = locked;
    select.setAttribute("aria-disabled", String(locked));
  }
  const button = cell.querySelector(".cell-lock-button");
  if (button) {
    button.textContent = locked ? "■" : "□";
    button.setAttribute("aria-pressed", String(locked));
    button.title = locked ? "ロック解除" : "このセルをロック";
    const employeeName = state.employees.find((employee) => employee.id === cell.dataset.employeeId)?.name ?? "従業員";
    button.setAttribute("aria-label", `${employeeName} ${cell.dataset.day}日のシフトを${locked ? "ロック解除" : "ロック"}`);
  }
}

function applyLockToCell(cell, locked) {
  const employeeId = cell.dataset.employeeId;
  const day = Number(cell.dataset.day);
  if (!employeeId || !Number.isInteger(day)) return false;
  if (isShiftLocked(employeeId, day) === locked) return false;
  setShiftLock(employeeId, day, locked, { save: false });
  updateCellVisual(cell, locked);
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
  const targetLocked = lockState.targetLocked;
  activeStroke = {
    pointerId: event.pointerId,
    targetLocked,
    transaction: beginHistoryTransaction(historyLabel(targetLocked)),
    stroke: createPaintStroke((targetCell) => applyLockToCell(targetCell, targetLocked))
  };
  tableContainer.classList.add("lock-stroke-active");
  document.body.classList.add("lock-dragging");
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
  tableContainer.classList.remove("lock-stroke-active");
  document.body.classList.remove("lock-dragging");
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
    setStatus(`${summary.changedCount}セルを${actionLabel(finished.targetLocked)}しました`);
  } else {
    cancelHistoryTransaction(finished.transaction);
    syncLockInput();
  }
}

function toggleIndividualLock(button) {
  const cell = button.closest(".shift-lock-cell");
  if (!cell) return;
  const employeeId = cell.dataset.employeeId;
  const day = Number(cell.dataset.day);
  const nextLocked = !isShiftLocked(employeeId, day);
  runWithHistory(`${day}日のセル${actionLabel(nextLocked)}`, () => {
    setShiftLock(employeeId, day, nextLocked);
  });
  onStrokeComplete();
  setStatus(`${day}日のセルを${actionLabel(nextLocked)}しました`);
}

function applyKeyboardLock(event) {
  if (!active() || !["Enter", " "].includes(event.key)) return;
  const cell = event.target.closest(".shift-lock-cell");
  if (!cell) return;
  event.preventDefault();
  const transaction = beginHistoryTransaction(historyLabel());
  const changed = applyLockToCell(cell, lockState.targetLocked);
  if (changed) {
    scheduleSave();
    commitHistoryTransaction(transaction);
    onStrokeComplete();
    setStatus(`1セルを${actionLabel()}しました`);
  } else {
    cancelHistoryTransaction(transaction);
  }
}

export function initializeLockInput(options) {
  if (initialized) return;
  initialized = true;
  loadStylesheet();
  tableContainer = options.tableContainer;
  onStrokeComplete = options.onStrokeComplete ?? onStrokeComplete;
  setStatus = options.setStatus ?? setStatus;
  controls = createControls();

  tableContainer.addEventListener("click", (event) => {
    const button = event.target.closest(".cell-lock-button");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (!active()) toggleIndividualLock(button);
  });
  tableContainer.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest(".shift-lock-cell");
    if (cell) beginStroke(event, cell);
  });
  tableContainer.addEventListener("pointermove", moveStroke);
  tableContainer.addEventListener("pointerup", finishStroke);
  tableContainer.addEventListener("pointercancel", finishStroke);
  tableContainer.addEventListener("lostpointercapture", finishStroke);
  tableContainer.addEventListener("keydown", applyKeyboardLock);
  globalThis.addEventListener("blur", () => finishStroke());
  subscribeMonthEditMode(syncLockInput);
  new MutationObserver(syncLockInput).observe(tableContainer, { childList: true });
  syncLockInput();
}

export function syncLockInput() {
  if (!controls) return;
  updateControls();
  updateTableMode();
}
