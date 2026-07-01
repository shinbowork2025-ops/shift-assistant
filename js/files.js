import {
  SHIFT_TYPES,
  state,
  getDaysInMonth,
  getShift,
  employeeSummary,
  normalizeState,
  saveNow
} from "./model.js";

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

export function exportCsv() {
  const numberOfDays = getDaysInMonth(state.selectedMonth);
  const header = ["氏名", "コード"];
  for (let day = 1; day <= numberOfDays; day += 1) header.push(`${day}日`);
  header.push("勤務日数", "勤務時間");

  const rows = [header];
  for (const employee of state.employees) {
    const row = [employee.name, employee.code];
    for (let day = 1; day <= numberOfDays; day += 1) {
      row.push(SHIFT_TYPES[getShift(employee.id, day)]?.label ?? "");
    }
    const summary = employeeSummary(employee.id);
    row.push(summary.workDays, summary.hours);
    rows.push(row);
  }

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  downloadFile(`shift-${state.selectedMonth}.csv`, csv, "text/csv;charset=utf-8");
}

export function backupJson() {
  const backup = {
    ...structuredClone(state),
    exportedAt: new Date().toISOString(),
    application: "Shift Assistant"
  };
  const fileName = `shift-assistant-backup-${new Date().toISOString().slice(0, 10)}.json`;
  downloadFile(fileName, JSON.stringify(backup, null, 2), "application/json");
}

export async function restoreJson(file) {
  if (!file) return;
  const text = await file.text();
  normalizeState(JSON.parse(text));
  await saveNow();
}
