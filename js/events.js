import { state, scheduleViewStateSave } from "./model.js";
import { exportCsv, backupJson, downloadMasterWorkbookSample } from "./files.js";
import {
  elements,
  openWorkspaceDialog,
  closeWorkspaceDialog,
  openEmployeeDialog,
  closeEmployeeDialog,
  resolveConfirmation,
  setSaveStatus,
  setImportStatus
} from "./elements.js";
import {
  refresh,
  refreshPrintPreview,
  printCurrentWorkspace,
  changeWorkspace,
  saveWorkspaceFromDialog,
  duplicateCurrentWorkspace,
  deleteCurrentWorkspace,
  selectDate,
  shiftMonth,
  shiftDay,
  changeView,
  handleShiftChange,
  moveEmployeeBreak,
  saveEmployeeFromDialog,
  deleteEmployeeFromDialog,
  autoPlaceBreaks,
  importMasterFile,
  restoreBackupFile,
  clearCurrentMonth
} from "./actions.js";

const BREAK_DRAG_MIME = "application/x-shift-assistant-break";
let currentBreakDragPayload = null;

function bindWorkspaceEvents() {
  elements.workspaceSelect.addEventListener("change", async () => {
    try {
      await changeWorkspace(elements.workspaceSelect.value);
    } catch (error) {
      console.error(error);
      setSaveStatus(`シフト表の切替失敗: ${error.message}`, true);
      refresh();
    }
  });
  elements.newWorkspaceButton.addEventListener("click", () => openWorkspaceDialog("new"));
  elements.editWorkspaceButton.addEventListener("click", () => openWorkspaceDialog("edit"));
  elements.duplicateWorkspaceButton.addEventListener("click", duplicateCurrentWorkspace);
  elements.deleteWorkspaceButton.addEventListener("click", deleteCurrentWorkspace);
  elements.closeWorkspaceDialogButton.addEventListener("click", closeWorkspaceDialog);
  elements.cancelWorkspaceButton.addEventListener("click", closeWorkspaceDialog);
  elements.workspaceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveWorkspaceFromDialog();
  });
}

function bindNavigationEvents() {
  elements.monthViewButton.addEventListener("click", () => changeView("month"));
  elements.dayViewButton.addEventListener("click", () => changeView("day"));
  elements.printViewButton.addEventListener("click", () => changeView("print"));

  elements.previousMonthButton.addEventListener("click", () => shiftMonth(-1));
  elements.nextMonthButton.addEventListener("click", () => shiftMonth(1));
  elements.previousDayButton.addEventListener("click", () => shiftDay(-1));
  elements.nextDayButton.addEventListener("click", () => shiftDay(1));

  elements.monthInput.addEventListener("change", () => {
    if (!elements.monthInput.value) return;
    state.selectedMonth = elements.monthInput.value;
    state.selectedDate = `${state.selectedMonth}-01`;
    refresh();
    scheduleViewStateSave();
  });
  elements.dateInput.addEventListener("change", () => {
    if (elements.dateInput.value) selectDate(elements.dateInput.value);
  });
}

function readBreakDragPayload(event) {
  if (currentBreakDragPayload) return currentBreakDragPayload;
  try {
    return JSON.parse(event.dataTransfer?.getData(BREAK_DRAG_MIME) || "");
  } catch {
    return null;
  }
}

function clearBreakDragState() {
  currentBreakDragPayload = null;
  elements.dailyChartContainer.querySelectorAll(".break-dragging, .break-drop-hover").forEach((cell) => {
    cell.classList.remove("break-dragging", "break-drop-hover");
  });
}

function bindBreakDragEvents() {
  elements.dailyChartContainer.addEventListener("dragstart", (event) => {
    const cell = event.target.closest(".break-draggable");
    if (!cell) return;
    const payload = {
      employeeId: cell.dataset.employeeId,
      employeeName: cell.dataset.employeeName,
      shiftCode: cell.dataset.shiftCode,
      day: Number(cell.dataset.day),
      dateValue: cell.dataset.dateValue,
      breakIndex: Number(cell.dataset.breakIndex)
    };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(BREAK_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", cell.title || "休憩");
    currentBreakDragPayload = payload;
    cell.classList.add("break-dragging");
  });

  elements.dailyChartContainer.addEventListener("dragover", (event) => {
    const target = event.target.closest(".break-drop-target");
    const payload = readBreakDragPayload(event);
    if (!target || !payload || target.dataset.employeeId !== payload.employeeId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    target.classList.add("break-drop-hover");
  });

  elements.dailyChartContainer.addEventListener("dragleave", (event) => {
    event.target.closest(".break-drop-target")?.classList.remove("break-drop-hover");
  });

  elements.dailyChartContainer.addEventListener("drop", (event) => {
    const target = event.target.closest(".break-drop-target");
    const payload = readBreakDragPayload(event);
    clearBreakDragState();
    if (!target || !payload || target.dataset.employeeId !== payload.employeeId) return;
    event.preventDefault();
    const result = moveEmployeeBreak({
      ...payload,
      newStartMinute: Number(target.dataset.slotStart)
    });
    setSaveStatus(
      result.ok
        ? `${payload.employeeName}さんの休憩を${result.before.start}〜${result.before.end}から${result.after.start}〜${result.after.end}へ移動しました`
        : result.message,
      !result.ok
    );
  });

  elements.dailyChartContainer.addEventListener("dragend", clearBreakDragState);
}

function bindScheduleEvents() {
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

  elements.dailyChartContainer.addEventListener("click", async (event) => {
    const editButton = event.target.closest(".break-edit-button");
    if (!editButton) return;
    const { openBreakEditDialog } = await import("./break-edit-ui.js");
    openBreakEditDialog({ employeeId: editButton.dataset.employeeId, setStatus: setSaveStatus });
  });

  elements.autoBreakButton.addEventListener("click", autoPlaceBreaks);
  elements.clearMonthButton.addEventListener("click", clearCurrentMonth);
  elements.coverageRequirementButton.addEventListener("click", async () => {
    const { openCoverageRequirementDialog } = await import("./coverage-requirements-ui.js");
    openCoverageRequirementDialog({ setStatus: setSaveStatus });
  });
  bindBreakDragEvents();
}

function bindEmployeeDialogEvents() {
  elements.addEmployeeButton.addEventListener("click", () => openEmployeeDialog());
  elements.closeEmployeeDialogButton.addEventListener("click", closeEmployeeDialog);
  elements.cancelEmployeeButton.addEventListener("click", closeEmployeeDialog);
  elements.employeeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEmployeeFromDialog();
  });
  elements.deleteEmployeeButton.addEventListener("click", deleteEmployeeFromDialog);
}

function bindPrintEvents() {
  elements.printModeSelect.addEventListener("change", refreshPrintPreview);
  elements.printButton.addEventListener("click", printCurrentWorkspace);
  globalThis.addEventListener("beforeprint", refreshPrintPreview);
}

async function downloadSampleWorkbook() {
  try {
    await downloadMasterWorkbookSample();
  } catch (error) {
    console.error(error);
    setImportStatus(`Excel見本の作成失敗: ${error.message}`, true);
  }
}

function bindDataEvents() {
  elements.importMasterButton.addEventListener("click", () => elements.importMasterInput.click());
  elements.importMasterInput.addEventListener("change", async () => {
    try {
      const file = elements.importMasterInput.files?.[0];
      if (file) await importMasterFile(file);
    } catch (error) {
      console.error(error);
      setImportStatus(`マスター読込失敗: ${error.message}`, true);
    } finally {
      elements.importMasterInput.value = "";
    }
  });
  elements.downloadSampleButton.addEventListener("click", downloadSampleWorkbook);

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
}

// 空状態のガイドから、既存の登録・読込操作へ誘導する。
// 読込系はデータ管理パネルを開いてから実行し、結果の状態表示が見えるようにする。
function bindGuideEvents() {
  elements.emptyAddEmployeeButton.addEventListener("click", () => openEmployeeDialog());
  elements.emptyImportButton.addEventListener("click", () => {
    elements.dataPanel.open = true;
    elements.importMasterInput.click();
  });
  elements.emptySampleButton.addEventListener("click", () => {
    elements.dataPanel.open = true;
    void downloadSampleWorkbook();
  });
}

function bindConfirmDialogEvents() {
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

export function bindEvents() {
  bindWorkspaceEvents();
  bindNavigationEvents();
  bindScheduleEvents();
  bindEmployeeDialogEvents();
  bindPrintEvents();
  bindDataEvents();
  bindGuideEvents();
  bindConfirmDialogEvents();
}
