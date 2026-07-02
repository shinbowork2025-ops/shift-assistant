import { state } from "../model.js";
import { ensureBreaksForDate } from "../breaks.js";
import { importMasterCsvText, importMasterRows, formatImportSummary } from "../csv.js";
import { readFirstWorksheetRows } from "../xlsx-lite.js";
import { restoreJson } from "../files.js";
import { runWithHistory, clearHistory } from "../history.js";
import { setSaveStatus, setImportStatus } from "../elements.js";
import { refresh } from "./view-actions.js";

export async function importMasterFile(file) {
  const lowerName = file.name.toLowerCase();
  let summary;
  let sourceLabel;

  if (lowerName.endsWith(".xlsx")) {
    const workbook = await readFirstWorksheetRows(file);
    summary = runWithHistory("Excelマスターを読み込み", () => importMasterRows(workbook.rows));
    sourceLabel = `Excel「${workbook.sheetName}」`;
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
