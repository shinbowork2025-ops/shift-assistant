import {
  state,
  createId,
  setShift,
  scheduleSave,
  loadSavedState,
  setStatusHandler,
  monthDisplayName
} from "./model.js";
import { render } from "./render.js";
import { exportCsv, backupJson, restoreJson } from "./files.js";

const elements = Object.fromEntries([
  "monthInput", "previousMonthButton", "nextMonthButton", "addEmployeeButton",
  "exportCsvButton", "backupButton", "restoreButton", "restoreInput",
  "clearMonthButton", "scheduleTitle", "saveStatus", "emptyState",
  "tableContainer", "shiftSelectTemplate", "employeeDialog", "employeeForm",
  "employeeDialogTitle", "employeeIdInput", "employeeNameInput", "employeeCodeInput",
  "closeEmployeeDialogButton", "cancelEmployeeButton", "deleteEmployeeButton",
  "confirmDialog", "confirmTitle", "confirmMessage", "confirmCancelButton", "confirmOkButton"
].map((id) => [id, document.querySelector(`#${id}`)]));

let confirmationResolver = null;

function setSaveStatus(message, isError = false) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.classList.toggle("error", isError);
}

function openEmployeeDialog(employeeId = "") {
  const employee = state.employees.find((item) => item.id === employeeId);
  elements.employeeForm.reset();
  elements.employeeIdInput.value = employee?.id ?? "";
  elements.employeeNameInput.value = employee?.name ?? "";
  elements.employeeCodeInput.value = employee?.code ?? "";
  elements.employeeDialogTitle.textContent = employee ? "従業員を編集" : "従業員を追加";
  elements.deleteEmployeeButton.hidden = !employee;
  elements.employeeDialog.showModal();
  elements.employeeNameInput.focus();
}

function closeEmployeeDialog() {
  elements.employeeDialog.close();
}

function shiftMonth(offset) {
  const [year, month] = state.selectedMonth.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  state.selectedMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  render(elements);
  scheduleSave();
}

function confirmAction(title, message, confirmLabel = "実行") {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmOkButton.textContent = confirmLabel;
  elements.confirmDialog.showModal();
  return new Promise((resolve) => { confirmationResolver = resolve; });
}

function resolveConfirmation(result) {
  if (confirmationResolver) confirmationResolver(result);
  confirmationResolver = null;
  elements.confirmDialog.close();
}

function bindEvents() {
  elements.previousMonthButton.addEventListener("click", () => shiftMonth(-1));
  elements.nextMonthButton.addEventListener("click", () => shiftMonth(1));
  elements.monthInput.addEventListener("change", () => {
    if (!elements.monthInput.value) return;
    state.selectedMonth = elements.monthInput.value;
    render(elements);
    scheduleSave();
  });

  elements.addEmployeeButton.addEventListener("click", () => openEmployeeDialog());
  elements.closeEmployeeDialogButton.addEventListener("click", closeEmployeeDialog);
  elements.cancelEmployeeButton.addEventListener("click", closeEmployeeDialog);

  elements.employeeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.employeeNameInput.value.trim();
    const code = elements.employeeCodeInput.value.trim();
    if (!name) return;

    const employeeId = elements.employeeIdInput.value;
    if (employeeId) {
      const employee = state.employees.find((item) => item.id === employeeId);
      if (employee) Object.assign(employee, { name, code });
    } else {
      state.employees.push({ id: createId(), name, code });
    }

    closeEmployeeDialog();
    render(elements);
    scheduleSave();
  });

  elements.deleteEmployeeButton.addEventListener("click", async () => {
    const employeeId = elements.employeeIdInput.value;
    const employee = state.employees.find((item) => item.id === employeeId);
    if (!employee) return;
    closeEmployeeDialog();
    const confirmed = await confirmAction("従業員を削除", `${employee.name}さんと、その人の全月のシフトデータを削除します。`, "削除");
    if (!confirmed) return;

    state.employees = state.employees.filter((item) => item.id !== employeeId);
    for (const month of Object.values(state.shifts)) delete month[employeeId];
    render(elements);
    scheduleSave();
  });

  elements.tableContainer.addEventListener("change", (event) => {
    const select = event.target.closest(".shift-select");
    if (!select) return;
    setShift(select.dataset.employeeId, Number(select.dataset.day), select.value);
    render(elements);
  });

  elements.tableContainer.addEventListener("click", (event) => {
    const button = event.target.closest(".employee-button");
    if (button) openEmployeeDialog(button.dataset.employeeId);
  });

  elements.exportCsvButton.addEventListener("click", exportCsv);
  elements.backupButton.addEventListener("click", backupJson);
  elements.restoreButton.addEventListener("click", () => elements.restoreInput.click());
  elements.restoreInput.addEventListener("change", async () => {
    try {
      await restoreJson(elements.restoreInput.files?.[0]);
      render(elements);
      setSaveStatus("バックアップを復元しました");
    } catch (error) {
      console.error(error);
      setSaveStatus(`復元失敗: ${error.message}`, true);
    } finally {
      elements.restoreInput.value = "";
    }
  });

  elements.clearMonthButton.addEventListener("click", async () => {
    const confirmed = await confirmAction("月間シフトをクリア", `${monthDisplayName(state.selectedMonth)}の入力済みシフトをすべて削除します。`, "クリア");
    if (!confirmed) return;
    delete state.shifts[state.selectedMonth];
    render(elements);
    scheduleSave();
  });

  elements.confirmCancelButton.addEventListener("click", (event) => {
    event.preventDefault();
    resolveConfirmation(false);
  });
  elements.confirmOkButton.addEventListener("click", (event) => {
    event.preventDefault();
    resolveConfirmation(true);
  });
  elements.confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    resolveConfirmation(false);
  });
}

async function initialize() {
  setStatusHandler(setSaveStatus);
  bindEvents();
  try {
    const hadSavedState = await loadSavedState();
    setSaveStatus(hadSavedState ? "保存データを読み込みました" : "新しいデータを開始しました");
  } catch (error) {
    console.error(error);
    setSaveStatus(`読込失敗: ${error.message}`, true);
  }
  render(elements);
}

initialize();
