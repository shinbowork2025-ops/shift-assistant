import { state, setShift, scheduleSave, monthDisplayName, dateKey } from "../model.js";
import { generateBreaksForDate } from "../breaks.js";
import { buildWorkShiftPlan } from "../auto-work-shifts.js";
import { runWithHistory } from "../history.js";
import { refresh } from "./view-actions.js";

export function createCurrentWorkShiftPlan({ selectedShiftCodes, mode }) {
  if (!Array.isArray(selectedShiftCodes) || selectedShiftCodes.length === 0) {
    throw new Error("自動割当に使う勤務シフトを1つ以上選択してください。");
  }
  return buildWorkShiftPlan({
    monthValue: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    shiftLocks: state.shiftLocks,
    coverageRequirements: state.coverageRequirements,
    selectedShiftCodes,
    mode
  });
}

export function applyCurrentWorkShiftPlan(plan) {
  let applied = 0;
  let skippedLocked = 0;
  const changedEmployeesByDate = new Map();

  if (plan.changes.length > 0) {
    runWithHistory(`${monthDisplayName(state.selectedMonth)}の勤務シフトを自動割当`, () => {
      for (const change of plan.changes) {
        const changed = setShift(change.employeeId, change.day, change.after, {
          save: false,
          respectLock: true
        });
        if (!changed) {
          skippedLocked += 1;
          continue;
        }
        applied += 1;
        const changedDate = dateKey(state.selectedMonth, change.day);
        if (!changedEmployeesByDate.has(changedDate)) changedEmployeesByDate.set(changedDate, new Set());
        changedEmployeesByDate.get(changedDate).add(change.employeeId);
      }

      for (const [changedDate, employeeIds] of changedEmployeesByDate) {
        generateBreaksForDate(changedDate, [...employeeIds], { save: false });
      }
      if (applied > 0) scheduleSave();
    });
  }

  refresh();
  return { ...plan, applied, skippedLocked };
}
