import { refresh } from "./actions.js";
import { initializeAutoDaysOffUi } from "./auto-days-off-ui.js";
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
initializeAutoDaysOffUi({ setStatus: setSaveStatus });
