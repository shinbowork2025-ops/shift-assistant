import { state, getActiveWorkspace, currentMonthValue } from "./model.js";
import { initializeEmployeeRestForm, populateEmployeeRestForm } from "./employee-rest-form.js";

const elementIds = [
  "workspaceSelect", "workspaceUpdatedAt", "newWorkspaceButton", "editWorkspaceButton",
  "duplicateWorkspaceButton", "deleteWorkspaceButton", "workspaceDialog", "workspaceForm",
  "workspaceDialogTitle", "workspaceModeInput", "workspaceNameInput", "workspaceMonthInput",
  "closeWorkspaceDialogButton", "cancelWorkspaceButton",
  "monthControls", "dayControls", "monthInput", "dateInput", "previousMonthButton", "nextMonthButton",
  "previousDayButton", "nextDayButton", "monthViewButton", "dayViewButton", "printViewButton", "addEmployeeButton",
  "importMasterButton", "importMasterInput", "downloadSampleButton", "exportCsvButton", "backupButton",
  "restoreButton", "restoreInput", "autoBreakButton", "clearMonthButton", "scheduleTitle", "dailyTitle",
  "printTitle", "printModeSelect", "printButton", "printPreviewContainer", "printPanel",
  "saveStatus", "importStatus", "emptyState", "dailyEmptyState", "tableContainer", "dailyChartContainer",
  "legend", "monthPanel", "dailyPanel", "employeeDialog", "employeeForm", "employeeDialogTitle",
  "employeeIdInput", "employeeNameInput", "employeeCodeInput", "employeeDepartmentInput", "employeeOrderInput",
  "employeeFixedOvertimeInput",
  "closeEmployeeDialogButton", "cancelEmployeeButton", "deleteEmployeeButton", "confirmDialog",
  "confirmTitle", "confirmMessage", "confirmCancelButton", "confirmOkButton"
];

export const elements = Object.fromEntries(elementIds.map((id) => [id, document.querySelector(`#${id}`)]));
let confirmationResolver = null;

export function setSaveStatus(message, isError = false) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.classList.toggle("error", isError);
}

export function setImportStatus(message, isError = false) {
  elements.importStatus.textContent = message;
  elements.importStatus.classList.toggle("error", isError);
}

export function openWorkspaceDialog(mode = "new") {
  const activeWorkspace = getActiveWorkspace();
  const isEdit = mode === "edit";
  elements.workspaceForm.reset();
  elements.workspaceModeInput.value = mode;
  elements.workspaceDialogTitle.textContent = isEdit ? "シフト表の設定" : "新しいシフト表";
  elements.workspaceNameInput.value = isEdit ? activeWorkspace?.name ?? "" : "";
  elements.workspaceMonthInput.value = isEdit ? state.selectedMonth : currentMonthValue();
  elements.workspaceDialog.showModal();
  elements.workspaceNameInput.focus();
}

export function closeWorkspaceDialog() {
  elements.workspaceDialog.close();
}

export function openEmployeeDialog(employeeId = "") {
  const employee = state.employees.find((item) => item.id === employeeId);
  initializeEmployeeRestForm();
  elements.employeeForm.reset();
  elements.employeeIdInput.value = employee?.id ?? "";
  elements.employeeNameInput.value = employee?.name ?? "";
  elements.employeeCodeInput.value = employee?.code ?? "";
  elements.employeeDepartmentInput.value = employee?.department ?? "";
  elements.employeeOrderInput.value = employee ? String(employee.order ?? "") : String(state.employees.length + 1);
  elements.employeeFixedOvertimeInput.value = employee ? String((employee.fixedOvertimeMinutes ?? 0) / 60) : "0";
  populateEmployeeRestForm(employee);
  elements.employeeDialogTitle.textContent = employee ? "従業員を編集" : "従業員を追加";
  elements.deleteEmployeeButton.hidden = !employee;
  elements.employeeDialog.showModal();
  elements.employeeNameInput.focus();
}

export function closeEmployeeDialog() {
  elements.employeeDialog.close();
}

export function confirmAction(title, message, confirmLabel = "実行") {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmOkButton.textContent = confirmLabel;
  elements.confirmDialog.showModal();
  return new Promise((resolve) => { confirmationResolver = resolve; });
}

export function resolveConfirmation(result) {
  if (confirmationResolver) confirmationResolver(result);
  confirmationResolver = null;
  elements.confirmDialog.close();
}
