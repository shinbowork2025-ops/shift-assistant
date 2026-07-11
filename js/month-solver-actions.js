import { generateBreaksForDate } from "./breaks.js";
import { runWithHistory } from "./history.js";
import { validateMonthSolverApplication } from "./month-solver-application.js";
import { buildMonthSolverPlan, monthSolverChanges } from "./month-solver-plan.js";
import { dateKey, isShiftLocked, scheduleSave, setShift, state } from "./model.js";
import { refresh } from "./actions/view-actions.js";

export function createCurrentMonthSolverPlan(options = {}) {
  return buildMonthSolverPlan({
    monthValue: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    shiftLocks: state.shiftLocks,
    coverageRequirements: state.coverageRequirements,
    selectedEmployeeIds: options.selectedEmployeeIds,
    selectedShiftCodes: options.selectedShiftCodes
  });
}

export function applyMonthSolverResult(result) {
  if (!result?.plan) throw new Error("有効な月間シフト案ではありません。");
  if (result.plan.monthValue !== state.selectedMonth) throw new Error("表示月が探索開始時から変更されています。もう一度案を作成してください。");

  const applicationValidation = validateMonthSolverApplication(result);
  if (!applicationValidation.ok) {
    const details = applicationValidation.issues.slice(0, 5).join(" / ");
    throw new Error(`適用条件を満たしていません。${details}`);
  }

  const changes = monthSolverChanges(result.plan, state.shifts);
  const newlyLocked = changes.filter((change) => isShiftLocked(change.employeeId, change.day));
  if (newlyLocked.length > 0) {
    const examples = newlyLocked.slice(0, 5).map((change) => `${change.employeeName}・${change.day}日`).join("、");
    throw new Error(`探索後にロックされたセルがあります（${examples}）。もう一度案を作成してください。`);
  }

  const changedDates = new Set();
  let applied = 0;
  let skippedLocked = 0;

  runWithHistory("月間ソルバーの案を適用", () => {
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
    // 休憩配置は日全体で相互作用するため、変更日の全従業員分を再計算する。
    for (const dateValue of changedDates) generateBreaksForDate(dateValue, null, { save: false });
    if (applied > 0) scheduleSave();
  });
  refresh();
  return { applied, skippedLocked, changedDates: changedDates.size, changes, applicationValidation };
}
