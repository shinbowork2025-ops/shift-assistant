import { state, scheduleSave } from "./model.js";
import { exportCsv, backupJson, downloadMasterCsvSample } from "./files.js";
import {
  elements,
  openEmployeeDialog,
  closeEmployeeDialog,
  resolveConfirmation,
  setSaveStatus,
  setImportStatus
} from "./elements.js";
import {
  refresh,
  selectDate,
  shiftMonth,
  shiftDay,
  changeView,
  handleShiftChange,
  saveEmployeeFromDialog,
  deleteEmployeeFromDialog,
  autoPlaceBreaks,
  importCsvFile,
  restoreBackupFile,
  clearCurrentMonth
} from "./actions.js";

export function bindEvents() {
  elements.previousMonthButton.addEventListener("click", () => shiftMonth(-1));
  elements.nextMonthButton.addEventListener("click", () => shiftMonth(1));
  elements.previousDayButton.addEventListener("click", () => shiftDay(-1));
  elements.nextDayButton.addEventListener("click", () => shiftDay(1));

  elements.monthInput.addEventListener("change", () => {
    if (!elements.monthInput.value) return;
    state.selectedMonth = elements.monthInput.value;
    state.selectedDate = `${state.selectedMonth}-01`;
    refresh();
    scheduleSave();
  });
  elements.dateInput.addEventListener("change", () => {
    if (elements.dateInput.value) selectDate(elements.dateInput.value);
  });

  elements.monthViewButton.addEventListener("click", () => changeView("month"));
  elements.dayViewButton.addEventListener("click", () => changeView("day"));
  elements.autoBreakButton.addEventListener("click", autoPlaceBreaks);

  elements.addEmployeeButton.addEventListener("click", () => openEmployeeDialog());
  elements.closeEmployeeDialogButton.addEventListener("click", closeEmployeeDialog);
  elements.cancelEmployeeButton.addEventListener("click", closeEmployeeDialog);
  elements.employeeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEmployeeFromDialog();
  });
  elements.deleteEmployeeButton.addEventListener("click", deleteEmployeeFromDialog);

  for (const container of [elements.tableContainer, elements.dailyChartContainer]) {
    container.addEventListener("change", (event) => {
      const select = event.target.closest(".shift-select");
      if (select) handleShiftChange(select);
    });
  }

  elements.tableContainer.addEventListener("click", (event) => {
    const employeeButton = event.target.closest(".employee-button");
    if (employeeButton) openEmployeeDialog(employeeButton.dataset.employeeId);
    const dayButton = event.target.closest(".day-view-button");
    if (dayButton) selectDate(`${state.selectedMonth}-${String(Number(dayButton.dataset.day)).padStart(2, "0")}`);
  });

  elements.importCsvButton.addEventListener("click", () => elements.importCsvInput.click());
  elements.importCsvInput.addEventListener("change", async () => {
    try {
      const file = elements.importCsvInput.files?.[0];
      if (file) await importCsvFile(file);
    } catch (error) {
      console.error(error);
      setImportStatus(`CSV読込失敗: ${error.message}`, true);
    } finally {
      elements.importCsvInput.value = "";
    }
  });
  elements.downloadSampleButton.addEventListener("click", downloadMasterCsvSample);

  elements.exportCsvButton.addEventListener("click", exportCsv);
  elements.backupButton.addEventListener("click", backupJson);
  elements.restoreButton.addEventListener("click", () => elements.restoreInput.click());
  elements.restoreInput.addEventListener("change", async () => {
    try {
      const file = elements.restoreInput.files?.[0];
      if (file) await restoreBackupFile(file);
    } catch (error) {
      console.error(error);
      setSaveStatus(`復元失敗: ${error.message}`, true);
    } finally {
      elements.restoreInput.value = "";
    }
  });

  elements.clearMonthButton.addEventListener("click", clearCurrentMonth);
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
