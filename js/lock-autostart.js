import { refresh } from "./actions.js";
import { initializeAutoDaysOffUi } from "./auto-days-off-ui.js";
import { initializeAutoWorkShiftUi } from "./auto-work-shift-ui.js";
import { initializeEmployeeRestBadges } from "./employee-rest-badges.js";
import { initializeMonthEditToolbar } from "./month-edit-toolbar.js";
import { initializeMonthSolverSimpleUi } from "./month-solver-simple-ui.js";
import { initializeMonthSolverUi } from "./month-solver-ui.js";
import { initializeMonthViewControls } from "./month-view-controls.js";
import { elements, setSaveStatus } from "./elements.js";
import { initializeDailyLockSync } from "./daily-lock-sync.js";
import { initializeLockInput } from "./lock-input.js";
import { initializeOffRequestInput } from "./off-request-input.js";
import { initializeMonthClearState } from "./month-clear-state.js";

initializeLockInput({
  tableContainer: elements.tableContainer,
  onStrokeComplete: refresh,
  setStatus: setSaveStatus
});
initializeOffRequestInput({
  tableContainer: elements.tableContainer,
  onStrokeComplete: refresh,
  setStatus: setSaveStatus
});
initializeMonthEditToolbar();
initializeMonthViewControls();
initializeDailyLockSync();
initializeMonthClearState(elements.tableContainer);
initializeEmployeeRestBadges(elements.tableContainer);
initializeAutoDaysOffUi({ setStatus: setSaveStatus });
initializeAutoWorkShiftUi({ setStatus: setSaveStatus });
initializeMonthSolverUi({ setStatus: setSaveStatus });
initializeMonthSolverSimpleUi();
