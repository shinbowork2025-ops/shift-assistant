import {
  state,
  createId,
  setShift,
  scheduleSave,
  monthDisplayName,
  dateKey,
  getDaysInMonth
} from "./model.js";
import { generateBreaksForDate, ensureBreaksForDate } from "./breaks.js";
import { importMasterCsvText, formatImportSummary } from "./csv.js";
import { restoreJson } from "./files.js";
import { render } from "./render.js";
import {
  elements,
  setSaveStatus,
  setImportStatus,
  closeEmployeeDialog,
  confirmAction
} from "./elements.js";

export function refresh() {
  render(elements);
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
  const changedDate = dateKey(state.selectedMonth, day);
  setShift(select.dataset.employeeId, day, select.value);
  generateBreaksForDate(changedDate);
  if (state.currentView === "day") state.selectedDate = changedDate;
  refresh();
}

export function saveEmployeeFromDialog() {
  const name = elements.employeeNameInput.value.trim();
  const code = elements.employeeCodeInput.value.trim();
  const department = elements.employeeDepartmentInput.value.trim();
  if (!name) return;

  const employeeId = elements.employeeIdInput.value;
  if (employeeId) {
    const employee = state.employees.find((item) => item.id === employeeId);
    if (employee) Object.assign(employee, { name, code, department });
  } else {
    state.employees.push({ id: createId("employee"), name, code, department, order: state.employees.length + 1 });
  }
  closeEmployeeDialog();
  generateBreaksForDate(state.selectedDate);
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

export async function importCsvFile(file) {
  const summary = importMasterCsvText(await file.text());
  state.breaks = {};
  ensureBreaksForDate(state.selectedDate);
  refresh();
  setImportStatus(formatImportSummary(summary), summary.errors.length > 0);
  if (summary.errors.length) console.warn(summary.errors.join("\n"));
}

export async function restoreBackupFile(file) {
  await restoreJson(file);
  ensureBreaksForDate(state.selectedDate);
  refresh();
  setSaveStatus("バックアップを復元しました");
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
