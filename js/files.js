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
import { buildValidationRecord } from "./validation-profile.js";
import { buildBackupExport, extractBackupPayload, isBackupExport } from "./backup-export.js";

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
// 月間の要確認一覧が「ツール内検証OK」（未入力ゼロ・エラーゼロ）でない限り出力しない。
// これは候補案の品質ゲートであり、会社規則への完全適合や人による承認を表すものではない。
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
    throw new Error(`ツール内検証OKではないため出力できません（${reasons.join("・")}）。${firstIssues.join(" / ")}`);
  }

  const checkedAt = new Date().toISOString();
  const result = buildIntegrationExport({
    name: getActiveWorkspace()?.name ?? "",
    selectedMonth: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    breaks: state.breaks
  }, {
    generatedAt: checkedAt,
    validation: buildValidationRecord(readiness, { checkedAt })
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

function backupFileTimestamp(createdAt) {
  return createdAt.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

export async function backupJson() {
  const createdAt = new Date().toISOString();
  const exportId = globalThis.crypto?.randomUUID?.();
  if (!exportId) throw new Error("バックアップ識別子を作成できません。");
  workspaceState.settings ??= {};
  workspaceState.settings.lastBackupAt = createdAt;
  workspaceState.settings.lastBackupExportId = exportId;
  const backup = await buildBackupExport(getApplicationBackup(), { createdAt, exportId });
  const fileName = `shift-assistant-backup-${backupFileTimestamp(createdAt)}-${exportId.slice(0, 8)}.json`;
  downloadFile(fileName, JSON.stringify(backup, null, 2), "application/json");
  scheduleSave();
  globalThis.dispatchEvent(new CustomEvent("shift-assistant-backup-created", {
    detail: { createdAt, exportId, fileName, payloadSha256: backup.payloadSha256 }
  }));
  return { createdAt, exportId, fileName, payloadSha256: backup.payloadSha256 };
}

export async function restoreJson(file) {
  if (!file) return;
  const text = await file.text();
  const parsed = JSON.parse(text);
  const payload = isBackupExport(parsed) ? await extractBackupPayload(parsed) : parsed;
  await restoreApplicationState(payload);
}
