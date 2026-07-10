import {
  state,
  createId,
  getShift,
  isShiftLocked,
  setShift,
  scheduleSave,
  monthDisplayName,
  dateKey,
  removeShiftLocksForEmployee,
  clearShiftLocksForMonth
} from "../model.js";
import { generateBreaksForDate } from "../breaks.js";
import { normalizeEmploymentType } from "../employment-types.js";
import { compareEmployeeOrder } from "../workspace-normalizer.js";
import {
  removeRequestedDayOffInData,
  removeRequestedDaysOffForEmployee,
  clearRequestedDaysOffForMonth
} from "../requested-days-off.js";
import {
  setManualBreakLockInData,
  removeManualBreakLocksForEmployee
} from "../manual-break-locks.js";
import { readEmployeeRestForm } from "../employee-rest-form.js";
import { readEmployeeWorkShiftForm } from "../employee-work-shift-form.js";
import { runWithHistory } from "../history.js";
import {
  elements,
  setSaveStatus,
  closeEmployeeDialog,
  confirmAction
} from "../elements.js";
import { refresh } from "./view-actions.js";

export function handleShiftChange(select) {
  const day = Number(select.dataset.day);
  const employeeId = select.dataset.employeeId;
  const employeeName = state.employees.find((employee) => employee.id === employeeId)?.name ?? "従業員";
  const changedDate = dateKey(state.selectedMonth, day);
  if (isShiftLocked(employeeId, day)) {
    select.value = getShift(employeeId, day);
    setSaveStatus(`${employeeName}・${day}日はロック済みです。先にロックを解除してください`, true);
    return;
  }
  runWithHistory(`${employeeName}・${day}日のシフト変更`, () => {
    state.requestedDaysOff ??= {};
    state.manualBreakLocks ??= {};
    removeRequestedDayOffInData(state.requestedDaysOff, state.selectedMonth, employeeId, changedDate);
    setManualBreakLockInData(state.manualBreakLocks, changedDate, employeeId, false);
    setShift(employeeId, day, select.value, { save: false, respectLock: true });
    generateBreaksForDate(changedDate, [employeeId], { save: false, preserveManual: false });
    scheduleSave();
  });
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
  const employmentType = normalizeEmploymentType(elements.employeeEmploymentTypeInput.value);
  const restSettings = readEmployeeRestForm();
  const workShiftSettings = readEmployeeWorkShiftForm();
  const orderValue = Number(elements.employeeOrderInput.value);
  const hasValidOrder = Number.isFinite(orderValue) && orderValue > 0;
  const employeeId = elements.employeeIdInput.value;
  const label = employeeId ? "従業員情報を編集" : "従業員を追加";

  runWithHistory(label, () => {
    if (employeeId) {
      const employee = state.employees.find((item) => item.id === employeeId);
      if (employee) {
        Object.assign(employee, {
          name,
          code,
          department,
          employmentType,
          fixedOvertimeMinutes,
          qualifications: Array.isArray(employee.qualifications) ? employee.qualifications : [],
          ...restSettings,
          ...workShiftSettings
        });
        if (hasValidOrder) employee.order = orderValue;
      }
    } else {
      state.employees.push({
        id: createId("employee"),
        name,
        code,
        department,
        qualifications: [],
        employmentType,
        fixedOvertimeMinutes,
        ...restSettings,
        ...workShiftSettings,
        order: hasValidOrder ? orderValue : state.employees.length + 1
      });
    }
    state.employees.sort(compareEmployeeOrder);
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
  const confirmed = await confirmAction("従業員を削除", `${employee.name}さんと、その人の全月のシフト案・休憩・ロック・希望休・休憩保護を削除します。`, "削除");
  if (!confirmed) return;
  runWithHistory(`${employee.name}さんを削除`, () => {
    state.employees = state.employees.filter((item) => item.id !== employeeId);
    for (const month of Object.values(state.shifts)) delete month[employeeId];
    for (const dayBreaks of Object.values(state.breaks)) delete dayBreaks[employeeId];
    removeShiftLocksForEmployee(employeeId, { save: false });
    removeRequestedDaysOffForEmployee(state.requestedDaysOff ?? {}, employeeId);
    removeManualBreakLocksForEmployee(state.manualBreakLocks ?? {}, employeeId);
    scheduleSave();
  });
  refresh();
}

export function autoPlaceBreaks() {
  runWithHistory("当日の休憩を再配置", () => generateBreaksForDate(state.selectedDate));
  refresh();
  setSaveStatus("休憩を再配置しました（保護済みの手動休憩は維持）");
}

export async function clearCurrentMonth() {
  const confirmed = await confirmAction(
    "月間シフトをクリア",
    `${monthDisplayName(state.selectedMonth)}の入力済みシフト案・休憩・セルロック・希望休・休憩保護をすべて削除します。`,
    "クリア"
  );
  if (!confirmed) return;
  runWithHistory(`${monthDisplayName(state.selectedMonth)}をクリア`, () => {
    delete state.shifts[state.selectedMonth];
    for (const dateValue of Object.keys(state.breaks)) {
      if (dateValue.startsWith(state.selectedMonth)) delete state.breaks[dateValue];
    }
    for (const dateValue of Object.keys(state.manualBreakLocks ?? {})) {
      if (dateValue.startsWith(state.selectedMonth)) delete state.manualBreakLocks[dateValue];
    }
    clearShiftLocksForMonth(state.selectedMonth, { save: false });
    clearRequestedDaysOffForMonth(state.requestedDaysOff ?? {}, state.selectedMonth);
    scheduleSave();
  });
  refresh();
}
