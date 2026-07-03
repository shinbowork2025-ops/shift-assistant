import { state, getDaysInMonth, dateKey, scheduleViewStateSave } from "../model.js";
import { offsetDateValue, offsetMonthValue } from "../date-time.js";
import { ensureBreaksForDate } from "../breaks.js";
import { render } from "../render.js";
import { renderPrintPreview } from "../render-print.js";
import { undoHistory, redoHistory } from "../history.js";
import { elements, setSaveStatus } from "../elements.js";

// render()は表示中ビューだけを描画する。上部の更新日時も同期するため、
// 部分更新の呼び出し元もこの入口を使う。
export function refresh() {
  render(elements);
}

export function refreshPrintPreview() {
  renderPrintPreview(elements);
}

export function printCurrentWorkspace() {
  renderPrintPreview(elements, new Date());
  globalThis.requestAnimationFrame(() => globalThis.print());
}

export function undoLastAction() {
  const label = undoHistory();
  if (!label) return;
  ensureBreaksForDate(state.selectedDate);
  refresh();
  setSaveStatus(`「${label}」を元に戻しました`);
}

export function redoLastAction() {
  const label = redoHistory();
  if (!label) return;
  ensureBreaksForDate(state.selectedDate);
  refresh();
  setSaveStatus(`「${label}」をやり直しました`);
}

export function selectDate(dateValue, switchToDay = true) {
  state.selectedDate = dateValue;
  state.selectedMonth = dateValue.slice(0, 7);
  if (switchToDay) state.currentView = "day";
  ensureBreaksForDate(dateValue);
  scheduleViewStateSave();
  refresh();
}

export function shiftMonth(offset) {
  const nextMonth = offsetMonthValue(state.selectedMonth, offset);
  const currentDay = Math.min(Number(state.selectedDate.slice(-2)) || 1, getDaysInMonth(nextMonth));
  state.selectedMonth = nextMonth;
  state.selectedDate = dateKey(nextMonth, currentDay);
  scheduleViewStateSave();
  refresh();
}

export function shiftDay(offset) {
  selectDate(offsetDateValue(state.selectedDate, offset));
}

export function changeView(view) {
  state.currentView = view;
  if (view === "day") ensureBreaksForDate(state.selectedDate);
  scheduleViewStateSave();
  refresh();
}
