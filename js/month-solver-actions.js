import { runWithHistory } from "./history.js";
import { validateMonthSolverApplication } from "./month-solver-application.js";
import { buildMonthSolverPlan, monthSolverChanges } from "./month-solver-plan.js";
import {
  dateKey,
  getScheduleRevision,
  isShiftLocked,
  scheduleSave,
  setEmployeeBreaksForDate,
  setShift,
  state
} from "./model.js";
import { refresh } from "./actions/view-actions.js";
import { assertValidSolverBreakPolicies } from "./solver/shift-adapter.js";
import { createSolverInputFingerprint } from "./month-solver-worker-protocol.js";
import { setManualBreakLockInData } from "./manual-break-locks.js";

export function createCurrentMonthSolverPlan(options = {}) {
  assertValidSolverBreakPolicies(state.shiftTypes);
  return buildMonthSolverPlan({
    monthValue: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    shiftLocks: state.shiftLocks,
    breaks: state.breaks,
    manualBreakLocks: state.manualBreakLocks,
    coverageRequirements: state.coverageRequirements,
    selectedEmployeeIds: options.selectedEmployeeIds,
    selectedShiftCodes: options.selectedShiftCodes
  });
}

export function applyMonthSolverResult(result) {
  if (!result?.plan) throw new Error("有効な月間シフト案ではありません。");
  if (result.plan.monthValue !== state.selectedMonth) throw new Error("表示月が探索開始時から変更されています。もう一度案を作成してください。");
  if (result.scheduleRevision !== undefined
    && result.scheduleRevision !== null
    && Number(result.scheduleRevision) !== getScheduleRevision()) {
    throw new Error("探索開始後にシフト表の入力が変更されています。もう一度案を作成してください。");
  }
  if (result.inputFingerprint) {
    const currentPlan = buildMonthSolverPlan({
      monthValue: state.selectedMonth,
      employees: state.employees,
      shiftTypes: state.shiftTypes,
      shifts: state.shifts,
      shiftLocks: state.shiftLocks,
      breaks: state.breaks,
      manualBreakLocks: state.manualBreakLocks,
      coverageRequirements: state.coverageRequirements,
      selectedEmployeeIds: result.plan.selectedEmployeeIds,
      selectedShiftCodes: result.plan.selectedShiftCodes
    });
    if (createSolverInputFingerprint(currentPlan) !== result.inputFingerprint) {
      throw new Error("探索開始後に入力内容が変更されています。もう一度案を作成してください。");
    }
  }

  for (const change of result.shiftChanges ?? []) {
    const current = state.shifts?.[result.plan.monthValue]?.[change.employeeId]
      ?.[dateKey(result.plan.monthValue, change.day)] ?? "";
    if (current !== change.before) {
      throw new Error(`探索開始後に${change.employeeId}・${change.day}日の値が変更されています。`);
    }
  }
  for (const change of result.breakChanges ?? []) {
    const current = state.breaks?.[change.date]?.[change.employeeId] ?? [];
    if (JSON.stringify(current) !== JSON.stringify(change.before ?? [])) {
      throw new Error(`探索開始後に${change.employeeId}・${change.date}の休憩が変更されています。`);
    }
  }
  for (const change of result.manualBreakLockChanges ?? []) {
    const current = Boolean(state.manualBreakLocks?.[change.date]?.[change.employeeId]);
    if (current !== Boolean(change.before)) {
      throw new Error(`探索開始後に${change.employeeId}・${change.date}の休憩保護が変更されています。`);
    }
  }

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
  let appliedBreaks = 0;
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
    for (const change of result.breakChanges ?? []) {
      setEmployeeBreaksForDate(change.date, change.employeeId, cloneBreaks(change.after), { save: false });
      appliedBreaks += 1;
      changedDates.add(change.date);
    }
    for (const change of result.manualBreakLockChanges ?? []) {
      state.manualBreakLocks ??= {};
      setManualBreakLockInData(
        state.manualBreakLocks,
        change.date,
        change.employeeId,
        Boolean(change.after)
      );
    }
    if (applied > 0 || appliedBreaks > 0 || (result.manualBreakLockChanges?.length ?? 0) > 0) scheduleSave();
  });
  refresh();
  return {
    applied,
    appliedBreaks,
    skippedLocked,
    changedDates: changedDates.size,
    changes,
    applicationValidation
  };
}

function cloneBreaks(value) {
  return structuredClone(Array.isArray(value) ? value : []);
}
