import { generateBreaksForDate } from "./breaks.js";
import { setDayOffRequestInData } from "./day-off-requests.js";
import { monthPlanChanges, buildInitialMonthPlan } from "./month-plan-builder.js";
import { dateKey, scheduleSave, setShift, state } from "./model.js";
import { runWithHistory } from "./history.js";
import { refresh } from "./view-actions.js";

function requestData() {
  state.dayOffRequests ??= {};
  return state.dayOffRequests;
}

export function createCurrentInitialMonthPlan({ selectedEmployeeIds, selectedWorkShiftCodes }) {
  return buildInitialMonthPlan({
    monthValue: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    shiftLocks: state.shiftLocks,
    dayOffRequests: requestData(),
    selectedEmployeeIds,
    selectedWorkShiftCodes
  });
}

export function saveEmployeeDayOffRequests(employeeId, requestedDays) {
  const requested = new Set(requestedDays.map(Number));
  return runWithHistory("希望休を設定", () => {
    for (let day = 1; day <= 31; day += 1) {
      setDayOffRequestInData(requestData(), state.selectedMonth, employeeId, dateKey(state.selectedMonth, day), requested.has(day));
    }
    scheduleSave();
    refresh();
    return requested.size;
  });
}

export function applyMonthScheduleProposal(result) {
  if (!result?.plan || !result.hardCheck?.ok) throw new Error("有効な月間シフト案ではありません。");
  const changes = monthPlanChanges(result.plan, state.shifts);
  let applied = 0;
  let skippedLocked = 0;
  const changedByDate = new Map();

  runWithHistory("月間シフト案を適用", () => {
    for (const change of changes) {
      const changed = setShift(change.employeeId, change.day, change.after, {
        save: false,
        respectLock: true,
        monthValue: result.plan.monthValue
      });
      if (!changed) {
        skippedLocked += 1;
        continue;
      }
      applied += 1;
      const changedDate = dateKey(result.plan.monthValue, change.day);
      if (!changedByDate.has(changedDate)) changedByDate.set(changedDate, new Set());
      changedByDate.get(changedDate).add(change.employeeId);
    }
    for (const [changedDate, employeeIds] of changedByDate) {
      generateBreaksForDate(changedDate, [...employeeIds], { save: false });
    }
    if (applied > 0) scheduleSave();
  });
  refresh();
  return { applied, skippedLocked, changes };
}
