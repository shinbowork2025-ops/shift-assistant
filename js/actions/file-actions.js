import { state } from "../model.js";
import { ensureBreaksForDate } from "../breaks.js";
import { importMasterCsvText, importMasterRows, formatImportSummary } from "../csv.js";
import { prepareMasterWorkbookRows } from "../master-workbook.js";
import { restoreJson } from "../files.js";
import { runWithHistory, clearHistory } from "../history.js";
import { setSaveStatus, setImportStatus } from "../elements.js";
import { refresh } from "./view-actions.js";

export async function importMasterFile(file) {
  const lowerName = file.name.toLowerCase();
  let summary;
  let sourceLabel;

  if (lowerName.endsWith(".xlsx")) {
    const { readWorkbookRows } = await import("../xlsx-lite.js");
    const workbook = await readWorkbookRows(file);
    const prepared = prepareMasterWorkbookRows(workbook.worksheets);
    summary = runWithHistory("Excelマスターを読み込み", () => importMasterRows(prepared.rows));
    summary.ignoredSupplementRows = prepared.ignoredSupplementRows;
    summary.filledShiftNames = prepared.filledShiftNames;
    sourceLabel = `Excel「${prepared.usedSheetNames.join("＋")}」`;
  } else if (lowerName.endsWith(".csv") || file.type.includes("csv") || file.type.startsWith("text/")) {
    const text = await file.text();
    summary = runWithHistory("CSVマスターを読み込み", () => importMasterCsvText(text));
    sourceLabel = "CSV";
  } else {
    throw new Error("対応形式はCSVまたは.xlsxです。古い.xls形式には対応していません。");
  }

  ensureBreaksForDate(state.selectedDate);
  refresh();
  setImportStatus(formatImportSummary(summary, sourceLabel), summary.errors.length > 0);
  if (summary.errors.length) console.warn(summary.errors.join("\n"));
}

export async function restoreBackupFile(file) {
  await restoreJson(file);
  clearHistory();
  ensureBreaksForDate(state.selectedDate);
  refresh();
  setSaveStatus("全シフト表のバックアップを復元しました。操作履歴は初期化しました");
}
