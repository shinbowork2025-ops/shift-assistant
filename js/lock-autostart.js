import { refresh } from "./actions.js";
import { elements, setSaveStatus } from "./elements.js";
import { initializeLockInput } from "./lock-input.js";

initializeLockInput({
  tableContainer: elements.tableContainer,
  onStrokeComplete: refresh,
  setStatus: setSaveStatus
});
