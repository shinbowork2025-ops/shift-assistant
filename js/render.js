import {
  state,
  monthDisplayName,
  dateDisplayName,
  getWorkspaceList,
  getActiveWorkspace
} from "./model.js";
import { renderLegend } from "./render-common.js";
import { renderMonthTable } from "./render-month.js";
import { renderDailyTable } from "./render-day.js";
import { renderPrintPreview } from "./render-print.js";
import { syncPaintInput } from "./paint-input.js";

function formatUpdatedAt(value) {
  if (!value) return "更新日時なし";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新日時なし";
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderWorkspaceControls(elements) {
  const workspaces = getWorkspaceList();
  const activeWorkspace = getActiveWorkspace();
  const fragment = document.createDocumentFragment();

  for (const workspace of workspaces) {
    const option = document.createElement("option");
    option.value = workspace.id;
    option.textContent = `${workspace.name}｜${monthDisplayName(workspace.targetMonth)}｜更新 ${formatUpdatedAt(workspace.updatedAt)}`;
    fragment.append(option);
  }

  elements.workspaceSelect.replaceChildren(fragment);
  elements.workspaceSelect.value = activeWorkspace?.id ?? "";
  elements.workspaceUpdatedAt.textContent = activeWorkspace
    ? `${activeWorkspace.name}・${monthDisplayName(state.selectedMonth)}・最終更新 ${formatUpdatedAt(activeWorkspace.updatedAt)}`
    : "シフト表がありません";
  elements.deleteWorkspaceButton.disabled = workspaces.length <= 1;
}

export function renderShell(elements) {
  renderWorkspaceControls(elements);
  elements.monthInput.value = state.selectedMonth;
  elements.dateInput.value = state.selectedDate;
  const workspaceName = getActiveWorkspace()?.name ?? "シフト表";
  elements.scheduleTitle.textContent = `${workspaceName}｜${monthDisplayName(state.selectedMonth)}`;
  elements.dailyTitle.textContent = `${workspaceName}｜${dateDisplayName(state.selectedDate)} 時間帯チャート`;
  elements.monthViewButton.classList.toggle("active", state.currentView === "month");
  elements.dayViewButton.classList.toggle("active", state.currentView === "day");
  elements.printViewButton.classList.toggle("active", state.currentView === "print");
  elements.monthPanel.hidden = state.currentView !== "month";
  elements.dailyPanel.hidden = state.currentView !== "day";
  elements.printPanel.hidden = state.currentView !== "print";
  elements.monthControls.hidden = state.currentView !== "month";
  elements.dayControls.hidden = state.currentView !== "day";
  elements.legend.hidden = state.currentView === "print";
}

export function renderActiveView(elements) {
  if (state.currentView === "day") {
    renderLegend(elements);
    renderDailyTable(elements);
    return;
  }
  if (state.currentView === "print") {
    renderPrintPreview(elements);
    return;
  }

  renderLegend(elements);
  renderMonthTable(elements);
  syncPaintInput();
}

export function render(elements) {
  renderShell(elements);
  renderActiveView(elements);
}
