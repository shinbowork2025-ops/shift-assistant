import {
  state,
  createId,
  setShift,
  scheduleSave,
  monthDisplayName,
  dateKey
} from "../model.js";
import { generateBreaksForDate } from "../breaks.js";
import { runWithHistory } from "../history.js";
import {
  elements,
  setSaveStatus,
  closeEmployeeDialog,
  confirmAction
} from "../elements.js";
import { refresh, refreshActiveView } from "./view-actions.js";

export function handleShiftChange(select) {
  const day = Number(select.dataset.day);
  const employeeId = select.dataset.employeeId;
  const employeeName = state.employees.find((employee) => employee.id === employeeId)?.name ?? "従業員";
  const changedDate = dateKey(state.selectedMonth, day);

  runWithHistory(`${employeeName}・${day}日のシフト変更`, () => {
    setShift(employeeId, day, select.value, { save: false });
    generateBreaksForDate(changedDate, [employeeId], { save: false });
    scheduleSave();
  });

  if (state.currentView === "day") state.selectedDate = changedDate;
  refreshActiveView();
}

export function saveEmployeeFromDialog() {
  const name = elements.employeeNameInput.value.trim();
  const code = elements.employeeCodeInput.value.trim();
  const department = elements.employeeDepartmentInput.value.trim();
  const fixedOvertimeHours = Number(elements.employeeFixedOvertimeInput.value || 0);
  if (!name || !Number.isFinite(fixedOvertimeHours) || fixedOvertimeHours < 0) return;
  const fixedOvertimeMinutes = Math.round(fixedOvertimeHours * 60);
  const employeeId = elements.employeeIdInput.value;
  const label = employeeId ? "従業員情報を編集" : "従業員を追加";

  runWithHistory(label, () => {
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
    scheduleSave();
  });

  closeEmployeeDialog();
  refresh();
}

export async function deleteEmployeeFromDialog() {
  const employeeId = elements.employeeIdInput.value;
  const employee = state.employees.find((item) => item.id === employeeId);
  if (!employee) return;
  closeEmployeeDialog();
  const confirmed = await confirmAction("従業員を削除", `${employee.name}さんと、その人の全月のシフト案を削除します。`, "削除");
  if (!confirmed) return;

  runWithHistory(`${employee.name}さんを削除`, () => {
    state.employees = state.employees.filter((item) => item.id !== employeeId);
    for (const month of Object.values(state.shifts)) delete month[employeeId];
    for (const dayBreaks of Object.values(state.breaks)) delete dayBreaks[employeeId];
    scheduleSave();
  });
  refresh();
}

export function autoPlaceBreaks() {
  runWithHistory("当日の休憩を再配置", () => generateBreaksForDate(state.selectedDate));
  refreshActiveView();
  setSaveStatus("休憩を再配置しました");
}

export async function clearCurrentMonth() {
  const confirmed = await confirmAction("月間シフトをクリア", `${monthDisplayName(state.selectedMonth)}の入力済みシフト案と休憩をすべて削除します。`, "クリア");
  if (!confirmed) return;

  runWithHistory(`${monthDisplayName(state.selectedMonth)}をクリア`, () => {
    delete state.shifts[state.selectedMonth];
    for (const dateValue of Object.keys(state.breaks)) {
      if (dateValue.startsWith(state.selectedMonth)) delete state.breaks[dateValue];
    }
    scheduleSave();
  });
  refreshActiveView();
}
