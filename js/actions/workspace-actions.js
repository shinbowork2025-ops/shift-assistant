import {
  state,
  getActiveWorkspace,
  switchWorkspace,
  createWorkspace,
  updateActiveWorkspace,
  duplicateActiveWorkspace,
  deleteActiveWorkspace
} from "../model.js";
import { ensureBreaksForDate } from "../breaks.js";
import { runWithHistory, refreshHistoryStatus, clearHistory } from "../history.js";
import {
  elements,
  setSaveStatus,
  closeWorkspaceDialog,
  confirmAction
} from "../elements.js";
import { refresh } from "./view-actions.js";

export async function changeWorkspace(workspaceId) {
  await switchWorkspace(workspaceId);
  ensureBreaksForDate(state.selectedDate);
  refreshHistoryStatus();
  refresh();
  setSaveStatus(`「${getActiveWorkspace()?.name ?? "シフト表"}」を開きました`);
}

export function saveWorkspaceFromDialog() {
  const mode = elements.workspaceModeInput.value;
  const name = elements.workspaceNameInput.value.trim();
  const targetMonth = elements.workspaceMonthInput.value;
  if (!name || !/^\d{4}-\d{2}$/.test(targetMonth)) return;

  if (mode === "edit") {
    runWithHistory("シフト表の名称・対象月を変更", () => updateActiveWorkspace(name, targetMonth));
  } else {
    createWorkspace(name, targetMonth);
    refreshHistoryStatus();
  }

  closeWorkspaceDialog();
  refresh();
  setSaveStatus(mode === "edit" ? "シフト表の設定を更新しました" : "新しいシフト表を作成しました");
}

export function duplicateCurrentWorkspace() {
  const duplicate = duplicateActiveWorkspace();
  refreshHistoryStatus();
  refresh();
  setSaveStatus(`「${duplicate.name}」を作成しました`);
}

export async function deleteCurrentWorkspace() {
  const workspace = getActiveWorkspace();
  if (!workspace) return;
  const confirmed = await confirmAction(
    "シフト表を削除",
    `「${workspace.name}」を削除します。従業員、シフト、休憩データもすべて削除されます。`,
    "削除"
  );
  if (!confirmed) return;

  try {
    const deletedWorkspaceId = workspace.id;
    await deleteActiveWorkspace();
    clearHistory(deletedWorkspaceId);
    ensureBreaksForDate(state.selectedDate);
    refresh();
    setSaveStatus("シフト表を削除しました");
  } catch (error) {
    setSaveStatus(error.message, true);
  }
}
