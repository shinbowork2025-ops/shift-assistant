import { state } from "../model.js";
import { ensureBreaksForDate, repairBrokenBreaks } from "../breaks.js";
import { parseCsv, importMasterRows, formatImportSummary } from "../csv.js";
import { prepareMasterWorkbookRows } from "../master-workbook.js";
import { canonicalizeMasterShiftRows } from "../master-shift-code-normalizer.js";
import { restoreJson } from "../files.js";
import { runWithHistory, clearHistory } from "../history.js";
import { setSaveStatus, setImportStatus } from "../elements.js";
import { refresh } from "./view-actions.js";

// マスター取込でシフト時刻が変わると、配置済みの休憩が勤務枠の外に残ることがある。
// 取込直後に全日付を修復し、時間外の休憩を持ち越さない。
function importMasterWithBreakRepair(rows) {
  const summary = importMasterRows(rows);
  summary.repairedBreakDates = repairBrokenBreaks({ save: true });
  return summary;
}

export async function importMasterFile(file) {
  const lowerName = file.name.toLowerCase();
  let summary;
  let sourceLabel;

  if (lowerName.endsWith(".xlsx")) {
    const { readWorkbookRows } = await import("../xlsx-lite.js");
    const workbook = await readWorkbookRows(file);
    const prepared = prepareMasterWorkbookRows(workbook.worksheets);
    const canonicalRows = canonicalizeMasterShiftRows(prepared.rows);
    summary = runWithHistory("Excelマスターを読み込み", () => importMasterWithBreakRepair(canonicalRows));
    summary.ignoredSupplementRows = prepared.ignoredSupplementRows;
    summary.filledShiftNames = prepared.filledShiftNames;
    sourceLabel = `Excel「${prepared.usedSheetNames.join("＋")}」`;
  } else if (lowerName.endsWith(".csv") || file.type.includes("csv") || file.type.startsWith("text/")) {
    const text = await file.text();
    const canonicalRows = canonicalizeMasterShiftRows(parseCsv(text));
    summary = runWithHistory("CSVマスターを読み込み", () => importMasterWithBreakRepair(canonicalRows));
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
