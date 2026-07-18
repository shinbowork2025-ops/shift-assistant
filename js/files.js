import {
  state,
  workspaceState,
  scheduleSave,
  getActiveWorkspace,
  getApplicationBackup,
  restoreApplicationState
} from "./model.js";
import { buildMonthOverview } from "./month-overview.js";
import { buildIntegrationExport, integrationAssignmentsToCsv } from "./integration-export.js";
import { validateMonthReadiness } from "./month-validation.js";

export function downloadFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  const needsFormulaGuard = /^[=@\t\r]/.test(text) || /^[+-](?![\d.])/.test(text);
  const guarded = needsFormulaGuard ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

function formatHours(hours) {
  return Number.isInteger(hours) ? hours : Number(hours.toFixed(2));
}

function safeFilePart(value) {
  return String(value ?? "shift")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 40) || "shift";
}

export function exportCsv() {
  const overview = buildMonthOverview({
    monthValue: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts
  });
  const header = ["氏名", "コード", ...overview.days.map((day) => `${day.day}日`)];
  header.push("勤務日数", "実働時間", "残業見込時間", "固定残業時間", "固定残業残時間");

  const rows = [header];
  for (const { employee, cells, summary } of overview.employeeRows) {
    rows.push([
      employee.name,
      employee.code,
      ...cells.map((cell) => cell.shiftType?.name ?? ""),
      summary.workDays,
      formatHours(summary.hours),
      formatHours(summary.overtimeHours),
      formatHours(summary.fixedOvertimeHours),
      formatHours(summary.overtimeRemainingHours)
    ]);
  }

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const workspaceName = safeFilePart(getActiveWorkspace()?.name);
  downloadFile(`${workspaceName}-${state.selectedMonth}.csv`, csv, "text/csv;charset=utf-8");
}

// 社内システム連携用の出力。契約はdocs/integration.mdを参照。
// 月間の要確認一覧が「転記準備OK」（未入力ゼロ・エラーゼロ）でない限り出力しない。
// 作りかけの月や検証違反を含むデータを下流のパイプラインへ流さないためのゲート。
function buildIntegrationExportOrThrow() {
  const readiness = validateMonthReadiness({
    monthValue: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    breaks: state.breaks,
    shiftLocks: state.shiftLocks,
    requestedDaysOff: state.requestedDaysOff ?? {},
    manualBreakLocks: state.manualBreakLocks ?? {},
    coverageRequirements: state.coverageRequirements ?? []
  });
  if (!readiness.ready) {
    const reasons = [];
    if (readiness.blankCount > 0) reasons.push(`未入力${readiness.blankCount}セル`);
    if (readiness.blockingCount > 0) reasons.push(`エラー${readiness.blockingCount}件`);
    const firstIssues = readiness.issues
      .filter((item) => item.severity === "error")
      .slice(0, 3)
      .map((item) => item.message);
    throw new Error(`転記準備OKではないため出力できません（${reasons.join("・")}）。${firstIssues.join(" / ")}`);
  }

  const result = buildIntegrationExport({
    name: getActiveWorkspace()?.name ?? "",
    selectedMonth: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    breaks: state.breaks
  }, {
    validation: {
      ready: true,
      blankCount: readiness.blankCount,
      errorCount: readiness.blockingCount,
      warningCount: readiness.warningCount,
      infoCount: readiness.infoCount
    }
  });
  if (!result.ok) throw new Error(result.errors.join(" / "));
  return result.data;
}

function integrationFileName(extension) {
  const workspaceName = safeFilePart(getActiveWorkspace()?.name);
  return `${workspaceName}-${state.selectedMonth}-integration.${extension}`;
}

export function exportIntegrationJson() {
  const data = buildIntegrationExportOrThrow();
  downloadFile(integrationFileName("json"), JSON.stringify(data, null, 2), "application/json");
}

export function exportIntegrationCsv() {
  const data = buildIntegrationExportOrThrow();
  downloadFile(integrationFileName("csv"), integrationAssignmentsToCsv(data), "text/csv;charset=utf-8");
}

export async function downloadMasterWorkbookSample() {
  const {
    SAMPLE_MASTER_WORKBOOK_FILE_NAME,
    SAMPLE_MASTER_WORKBOOK_MIME_TYPE,
    sampleMasterWorkbookBytes
  } = await import("./sample-master-workbook.js");
  downloadFile(
    SAMPLE_MASTER_WORKBOOK_FILE_NAME,
    sampleMasterWorkbookBytes(),
    SAMPLE_MASTER_WORKBOOK_MIME_TYPE
  );
}

export function backupJson() {
  const createdAt = new Date().toISOString();
  workspaceState.settings ??= {};
  workspaceState.settings.lastBackupAt = createdAt;
  const backup = getApplicationBackup();
  const fileName = `shift-assistant-all-workspaces-${createdAt.slice(0, 10)}.json`;
  downloadFile(fileName, JSON.stringify(backup, null, 2), "application/json");
  scheduleSave();
  globalThis.dispatchEvent(new CustomEvent("shift-assistant-backup-created", { detail: { createdAt } }));
}

export async function restoreJson(file) {
  if (!file) return;
  const text = await file.text();
  await restoreApplicationState(JSON.parse(text));
}
