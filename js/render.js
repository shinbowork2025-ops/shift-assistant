import { state, monthDisplayName, dateDisplayName } from "./model.js";
import { renderLegend } from "./render-common.js";
import { renderMonthTable } from "./render-month.js";
import { renderDailyTable } from "./render-day.js";

export function render(elements) {
  elements.monthInput.value = state.selectedMonth;
  elements.dateInput.value = state.selectedDate;
  elements.scheduleTitle.textContent = `${monthDisplayName(state.selectedMonth)} シフト表`;
  elements.dailyTitle.textContent = `${dateDisplayName(state.selectedDate)} 時間帯チャート`;
  elements.monthViewButton.classList.toggle("active", state.currentView === "month");
  elements.dayViewButton.classList.toggle("active", state.currentView === "day");
  elements.monthPanel.hidden = state.currentView !== "month";
  elements.dailyPanel.hidden = state.currentView !== "day";
  elements.monthControls.hidden = state.currentView !== "month";
  elements.dayControls.hidden = state.currentView !== "day";

  renderLegend(elements);
  renderMonthTable(elements);
  renderDailyTable(elements);
}
