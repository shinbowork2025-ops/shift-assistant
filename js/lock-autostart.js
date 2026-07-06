import { refresh } from "./actions.js";
import { initializeAutoDaysOffUi } from "./auto-days-off-ui.js";
import { initializeAutoWorkShiftUi } from "./auto-work-shift-ui.js";
import { initializeEmployeeRestBadges } from "./employee-rest-badges.js";
import { initializeMonthSolverUi } from "./month-solver-ui.js";
import { elements, setSaveStatus } from "./elements.js";
import { initializeDailyLockSync } from "./daily-lock-sync.js";
import { initializeLockInput } from "./lock-input.js";
import { initializeMonthClearState } from "./month-clear-state.js";

initializeLockInput({
  tableContainer: elements.tableContainer,
  onStrokeComplete: refresh,
  setStatus: setSaveStatus
});
initializeDailyLockSync();
initializeMonthClearState(elements.tableContainer);
initializeEmployeeRestBadges(elements.tableContainer);
initializeAutoDaysOffUi({ setStatus: setSaveStatus });
initializeAutoWorkShiftUi({ setStatus: setSaveStatus });
initializeMonthSolverUi({ setStatus: setSaveStatus });
