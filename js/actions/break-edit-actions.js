import { getBreaks, getShiftType, setEmployeeBreaksForDate, scheduleSave } from "../model.js";
import { moveBreakToStart } from "../break-drag.js";
import { runWithHistory } from "../history.js";
import { refresh } from "./view-actions.js";

export function saveEmployeeBreaks({ employeeId, employeeName, day, dateValue, breaks }) {
  runWithHistory(`${employeeName}・${day}日の休憩を編集`, () => {
    setEmployeeBreaksForDate(dateValue, employeeId, breaks, { save: false });
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
    setEmployeeBreaksForDate(dateValue, employeeId, result.breaks, { save: false });
    scheduleSave();
  });
  refresh();
  return result;
}
