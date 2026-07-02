import {
  state,
  createId,
  setShift,
  scheduleSave,
  monthDisplayName,
  dateKey,
  getDaysInMonth,
  getActiveWorkspace,
  switchWorkspace,
  createWorkspace,
  updateActiveWorkspace,
  duplicateActiveWorkspace,
  deleteActiveWorkspace
} from "./model.js";
import { generateBreaksForDate, ensureBreaksForDate } from "./breaks.js";
import { importMasterCsvText, importMasterRows, formatImportSummary } from "./csv.js";
import { readFirstWorksheetRows } from "./xlsx-lite.js";
import { restoreJson } from "./files.js";
import { render } from "./render.js";
import {
  elements,
  setSaveStatus,
  setImportStatus,
  closeWorkspaceDialog,
  closeEmployeeDialog,
  confirmAction
} from "./elements.js";

export function refresh() {
  render(elements);
}

export async function changeWorkspace(workspaceId) {
  await switchWorkspace(workspaceId);
  ensureBreaksForDate(state.selectedDate);
  refresh();
  setSaveStatus(`「${getActiveWorkspace()?.name ?? "シフト表"}」を開きました`);
}

export function saveWorkspaceFromDialog() {
  const mode = elements.workspaceModeInput.value;
  const name = elements.workspaceNameInput.value.trim();
  const targetMonth = elements.workspaceMonthInput.value;
  if (!name || !/^\d{4}-\d{2}$/.test(targetMonth)) return;

  if (mode === "edit") updateActiveWorkspace(name, targetMonth);
  else createWorkspace(name, targetMonth);

  closeWorkspaceDialog();
  refresh();
  setSaveStatus(mode === "edit" ? "シフト表の設定を更新しました" : "新しいシフト表を作成しました");
}

export function duplicateCurrentWorkspace() {
  const duplicate = duplicateActiveWorkspace();
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
    await deleteActiveWorkspace();
    ensureBreaksForDate(state.selectedDate);
    refresh();
    setSaveStatus("シフト表を削除しました");
  } catch (error) {
    setSaveStatus(error.message, true);
  }
}

export function selectDate(dateValue, switchToDay = true) {
  state.selectedDate = dateValue;
  state.selectedMonth = dateValue.slice(0, 7);
  if (switchToDay) state.currentView = "day";
  ensureBreaksForDate(dateValue);
  refresh();
  scheduleSave();
}

export function shiftMonth(offset) {
  const [year, month] = state.selectedMonth.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  state.selectedMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const currentDay = Math.min(Number(state.selectedDate.slice(-2)) || 1, getDaysInMonth(state.selectedMonth));
  state.selectedDate = dateKey(state.selectedMonth, currentDay);
  refresh();
  scheduleSave();
}

export function shiftDay(offset) {
  const [year, month, day] = state.selectedDate.split("-").map(Number);
  const date = new Date(year, month - 1, day + offset);
  selectDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
}

export function changeView(view) {
  state.currentView = view;
  if (view === "day") ensureBreaksForDate(state.selectedDate);
  refresh();
  scheduleSave();
}

export function handleShiftChange(select) {
  const day = Number(select.dataset.day);
  const employeeId = select.dataset.employeeId;
  const changedDate = dateKey(state.selectedMonth, day);
  setShift(employeeId, day, select.value);
  generateBreaksForDate(changedDate, [employeeId]);
  if (state.currentView === "day") state.selectedDate = changedDate;
  refresh();
}

export function saveEmployeeFromDialog() {
  const name = elements.employeeNameInput.value.trim();
  const code = elements.employeeCodeInput.value.trim();
  const department = elements.employeeDepartmentInput.value.trim();
  const fixedOvertimeHours = Number(elements.employeeFixedOvertimeInput.value || 0);
  if (!name || !Number.isFinite(fixedOvertimeHours) || fixedOvertimeHours < 0) return;
  const fixedOvertimeMinutes = Math.round(fixedOvertimeHours * 60);

  const employeeId = elements.employeeIdInput.value;
  if (employeeId) {
    const employee = state.employees.find((item) => item.id === employeeId);
    if (employee) Object.assign(employee, { name, code, department, fixedOvertimeMinutes });
  } else {
    state.employees.push({
      id: createId("employee"),
      name,
      code,
      department,
      fixedOvertimeMinutes,
      order: state.employees.length + 1
    });
  }
  closeEmployeeDialog();
  refresh();
  scheduleSave();
}

export async function deleteEmployeeFromDialog() {
  const employeeId = elements.employeeIdInput.value;
  const employee = state.employees.find((item) => item.id === employeeId);
  if (!employee) return;
  closeEmployeeDialog();
  const confirmed = await confirmAction("従業員を削除", `${employee.name}さんと、その人の全月のシフト案を削除します。`, "削除");
  if (!confirmed) return;

  state.employees = state.employees.filter((item) => item.id !== employeeId);
  for (const month of Object.values(state.shifts)) delete month[employeeId];
  for (const dayBreaks of Object.values(state.breaks)) delete dayBreaks[employeeId];
  refresh();
  scheduleSave();
}

export function autoPlaceBreaks() {
  generateBreaksForDate(state.selectedDate);
  refresh();
  setSaveStatus("休憩を再配置しました");
}

export async function importMasterFile(file) {
  const lowerName = file.name.toLowerCase();
  let summary;
  let sourceLabel;

  if (lowerName.endsWith(".xlsx")) {
    const workbook = await readFirstWorksheetRows(file);
    summary = importMasterRows(workbook.rows);
    sourceLabel = `Excel「${workbook.sheetName}」`;
  } else if (lowerName.endsWith(".csv") || file.type.includes("csv") || file.type.startsWith("text/")) {
    summary = importMasterCsvText(await file.text());
    sourceLabel = "CSV";
  } else {
    throw new Error("対応形式はCSVまたは.xlsxです。古い.xls形式には対応していません。");
  }

  ensureBreaksForDate(state.selectedDate);
  refresh();
  setImportStatus(formatImportSummary(summary, sourceLabel), summary.errors.length > 0);
  if (summary.errors.length) console.warn(summary.errors.join("\n"));
}

export async function restoreBackupFile(file) {
  await restoreJson(file);
  ensureBreaksForDate(state.selectedDate);
  refresh();
  setSaveStatus("全シフト表のバックアップを復元しました");
}

export async function clearCurrentMonth() {
  const confirmed = await confirmAction("月間シフトをクリア", `${monthDisplayName(state.selectedMonth)}の入力済みシフト案と休憩をすべて削除します。`, "クリア");
  if (!confirmed) return;
  delete state.shifts[state.selectedMonth];
  for (const dateValue of Object.keys(state.breaks)) {
    if (dateValue.startsWith(state.selectedMonth)) delete state.breaks[dateValue];
  }
  refresh();
  scheduleSave();
}
