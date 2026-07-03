import { state, setShift, scheduleSave, monthDisplayName } from "../model.js";
import { buildDaysOffPlan } from "../auto-days-off.js";
import { runWithHistory } from "../history.js";
import { refresh } from "./view-actions.js";

export function createCurrentDaysOffPlan({ offShiftCode, mode }) {
  return buildDaysOffPlan({
    monthValue: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    shiftLocks: state.shiftLocks,
    offShiftCode,
    mode
  });
}

export function applyCurrentDaysOffPlan(plan) {
  let applied = 0;
  let skippedLocked = 0;
  if (plan.changes.length > 0) {
    runWithHistory(`${monthDisplayName(state.selectedMonth)}の公休を自動配置`, () => {
      for (const change of plan.changes) {
        const changed = setShift(change.employeeId, change.day, change.after, {
          save: false,
          respectLock: true
        });
        if (changed) applied += 1;
        else skippedLocked += 1;
      }
      if (applied > 0) scheduleSave();
    });
  }
  refresh();
  return { ...plan, applied, skippedLocked };
}
