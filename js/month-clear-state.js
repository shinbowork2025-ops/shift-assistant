import { state } from "./model.js";

function hasMonthBreaks(monthValue) {
  return Object.keys(state.breaks).some((dateValue) => dateValue.startsWith(`${monthValue}-`));
}

function hasMonthLocks(monthValue) {
  return Object.keys(state.shiftLocks?.[monthValue] ?? {}).length > 0;
}

export function syncMonthClearButton() {
  const button = document.getElementById("clearMonthButton");
  if (!button) return;
  const monthValue = state.selectedMonth;
  button.disabled = !state.shifts[monthValue] && !hasMonthBreaks(monthValue) && !hasMonthLocks(monthValue);
}

export function initializeMonthClearState(tableContainer) {
  new MutationObserver(syncMonthClearButton).observe(tableContainer, { childList: true });
  syncMonthClearButton();
}
