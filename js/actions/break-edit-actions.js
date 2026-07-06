import { setEmployeeBreaksForDate, scheduleSave } from "../model.js";
import { runWithHistory } from "../history.js";
import { refresh } from "./view-actions.js";

export function saveEmployeeBreaks({ employeeId, employeeName, day, dateValue, breaks }) {
  runWithHistory(`${employeeName}・${day}日の休憩を編集`, () => {
    setEmployeeBreaksForDate(dateValue, employeeId, breaks, { save: false });
    scheduleSave();
  });
  refresh();
}
