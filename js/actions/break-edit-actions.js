import { state, getBreaks, getShiftType, setEmployeeBreaksForDate, scheduleSave } from "../model.js";
import { moveBreakToStart } from "../break-drag.js";
import { setManualBreakLockInData } from "../manual-break-locks.js";
import { runWithHistory } from "../history.js";
import { refresh } from "./view-actions.js";

export function saveEmployeeBreaks({
  employeeId,
  employeeName,
  day,
  dateValue,
  breaks,
  protectedFromAuto = true
}) {
  runWithHistory(`${employeeName}・${day}日の休憩を編集`, () => {
    state.manualBreakLocks ??= {};
    setEmployeeBreaksForDate(dateValue, employeeId, breaks, { save: false });
    setManualBreakLockInData(state.manualBreakLocks, dateValue, employeeId, protectedFromAuto && breaks.length > 0);
    scheduleSave();
  });
  refresh();
}

export function moveEmployeeBreak({ employeeId, employeeName, day, dateValue, shiftCode, breakIndex, newStartMinute }) {
  const currentBreaks = getBreaks(employeeId, dateValue);
  const result = moveBreakToStart({
    breaks: currentBreaks,
    breakIndex,
    newStartMinute,
    shiftType: getShiftType(shiftCode)
  });
  if (!result.ok) return result;

  runWithHistory(`${employeeName}・${day}日の休憩を移動`, () => {
    state.manualBreakLocks ??= {};
    setEmployeeBreaksForDate(dateValue, employeeId, result.breaks, { save: false });
    setManualBreakLockInData(state.manualBreakLocks, dateValue, employeeId, true);
    scheduleSave();
  });
  refresh();
  return result;
}
