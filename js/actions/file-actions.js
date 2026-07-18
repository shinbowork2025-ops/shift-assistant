import { state } from "../model.js";
import { ensureBreaksForDate, repairBrokenBreaks } from "../breaks.js";
import { parseCsv, prepareMasterImport, applyMasterImport, formatImportSummary } from "../csv.js";
import { prepareMasterWorkbookRows } from "../master-workbook.js";
import { canonicalizeMasterShiftRows } from "../master-shift-code-normalizer.js";
import { downloadFile, restoreJson } from "../files.js";
import { runWithHistory, clearHistory } from "../history.js";
import { setSaveStatus, setImportStatus } from "../elements.js";
import { confirmMasterImport } from "../master-import-preview-ui.js";
import { refresh } from "./view-actions.js";

// マスター取込でシフト時刻が変わると、配置済みの休憩が勤務枠の外に残ることがある。
// 取込直後に全日付を修復し、時間外の休憩を持ち越さない。
function importMasterWithBreakRepair(plan, allowPartial) {
  const summary = applyMasterImport(plan, { allowPartial });
  summary.repairedBreakDates = repairBrokenBreaks({ save: true });
  return summary;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function masterImportErrorsToCsv(errors) {
  const rows = [["行", "エラー内容"]];
  for (const message of errors) {
    const line = String(message).match(/^(\d+)行目:/)?.[1] ?? "";
    rows.push([line, message]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function downloadMasterImportErrors(errors) {
  downloadFile("master-import-errors.csv", masterImportErrorsToCsv(errors), "text/csv;charset=utf-8");
}

export async function importMasterFile(file) {
  const lowerName = file.name.toLowerCase();
  let plan;
  let sourceLabel;

  if (lowerName.endsWith(".xlsx")) {
    const { readWorkbookRows } = await import("../xlsx-lite.js");
    const workbook = await readWorkbookRows(file);
    const prepared = prepareMasterWorkbookRows(workbook.worksheets);
    const canonicalRows = canonicalizeMasterShiftRows(prepared.rows);
    plan = prepareMasterImport(canonicalRows);
    plan.summary.ignoredSupplementRows = prepared.ignoredSupplementRows;
    plan.summary.filledShiftNames = prepared.filledShiftNames;
    sourceLabel = `Excel「${prepared.usedSheetNames.join("＋")}」`;
  } else if (lowerName.endsWith(".csv") || file.type.includes("csv") || file.type.startsWith("text/")) {
    const text = await file.text();
    const canonicalRows = canonicalizeMasterShiftRows(parseCsv(text));
    plan = prepareMasterImport(canonicalRows);
    sourceLabel = "CSV";
  } else {
    throw new Error("対応形式はCSVまたは.xlsxです。古い.xls形式には対応していません。");
  }

  const confirmed = await confirmMasterImport(plan, {
    sourceLabel,
    downloadErrors: downloadMasterImportErrors
  });
  if (!confirmed) {
    setImportStatus(`${sourceLabel}の取込を中止しました。データは変更されていません`, plan.errors.length > 0);
    return { ...plan.summary, errors: [...plan.errors], applied: false, cancelled: true };
  }

  const summary = runWithHistory(
    `${sourceLabel}マスターを読み込み`,
    () => importMasterWithBreakRepair(plan, plan.errors.length > 0)
  );
  ensureBreaksForDate(state.selectedDate);
  refresh();
  setImportStatus(formatImportSummary(summary, sourceLabel), summary.partial);
  if (summary.errors.length) console.warn(summary.errors.join("\n"));
  return summary;
}

export async function restoreBackupFile(file) {
  await restoreJson(file);
  clearHistory();
  ensureBreaksForDate(state.selectedDate);
  refresh();
  setSaveStatus("全シフト表のバックアップを復元しました。操作履歴は初期化しました");
}
