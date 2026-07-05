import { generateBreaksForDate } from "./breaks.js";
import { setDayOffRequestInData } from "./day-off-requests.js";
import { monthPlanChanges, buildInitialMonthPlan } from "./month-plan-builder.js";
import { dateKey, scheduleSave, setShift, state } from "./model.js";
import { runWithHistory } from "./history.js";
import { refresh } from "./actions/view-actions.js";

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
  const changedDates = new Set();

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
      changedDates.add(dateKey(result.plan.monthValue, change.day));
    }
    // 月間探索のハード制約検証は、その日に勤務する全従業員へ初期休憩案を
    // 生成した状態で行っている。適用時に変更した従業員だけ休憩を再生成すると、
    // 変更のない既存シフトの休憩が未生成・古いまま残り、検証済みの案と実際の
    // 保存内容がずれて法定休憩違反になりうる。変更のあった日は勤務者全員分を
    // 再生成し、検証時と一致させる。
    for (const changedDate of changedDates) {
      generateBreaksForDate(changedDate, null, { save: false });
    }
    if (applied > 0) scheduleSave();
  });
  refresh();
  return { applied, skippedLocked, changes };
}
