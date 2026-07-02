import {
  state,
  getActiveWorkspace,
  getApplicationBackup,
  restoreApplicationState
} from "./model.js";
import { buildMonthOverview } from "./month-overview.js";
import { SAMPLE_MASTER_CSV } from "./csv.js";

function downloadFile(fileName, content, mimeType) {
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
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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

export function downloadMasterCsvSample() {
  downloadFile("shift-assistant-master-sample.csv", `\uFEFF${SAMPLE_MASTER_CSV}`, "text/csv;charset=utf-8");
}

export function backupJson() {
  const backup = getApplicationBackup();
  const fileName = `shift-assistant-all-workspaces-${new Date().toISOString().slice(0, 10)}.json`;
  downloadFile(fileName, JSON.stringify(backup, null, 2), "application/json");
}

export async function restoreJson(file) {
  if (!file) return;
  const text = await file.text();
  await restoreApplicationState(JSON.parse(text));
}
