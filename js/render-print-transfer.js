import { buildTransferPrintData, formatDuration } from "./print-data.js";
import { createCell, createDocumentHeader, printWeekendClass } from "./render-print-common.js";

export function renderTransferPrintDocument(workspace, printedAt) {
  const data = buildTransferPrintData(workspace);
  const article = document.createElement("article");
  article.className = "print-document print-transfer-document";
  article.append(createDocumentHeader(workspace, data.monthValue, printedAt, "社内システム転記一覧"));

  const table = document.createElement("table");
  table.className = "print-transfer-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["日付", "従業員", "シフト", "勤務時間", "休憩時刻", "休憩", "実働", "残業", "確認"].forEach((label) => {
    headerRow.append(createCell("th", label));
  });
  thead.append(headerRow);
  table.append(thead);

  data.groups.forEach((group) => {
    const tbody = document.createElement("tbody");
    tbody.className = "print-transfer-date-group";
    group.rows.forEach((row, index) => {
      const tableRow = document.createElement("tr");
      if (row.status !== "OK") tableRow.classList.add("print-warning-row");
      const dateLabel = index === 0 ? `${group.day}日（${group.label}）` : "";
      tableRow.append(createCell("th", dateLabel, `print-transfer-date ${printWeekendClass(group.weekday)}`));
      tableRow.append(createCell("td", [row.name, row.department].filter(Boolean).join(" / "), "print-transfer-employee"));
      tableRow.append(createCell("td", row.shiftName));
      tableRow.append(createCell("td", row.timeText || "—"));
      tableRow.append(createCell("td", row.breakText || "—", "print-transfer-breaks"));
      tableRow.append(createCell("td", row.breakMinutes ? formatDuration(row.breakMinutes) : "—"));
      tableRow.append(createCell("td", row.workMinutes ? formatDuration(row.workMinutes) : "—"));
      tableRow.append(createCell("td", row.overtimeMinutes ? formatDuration(row.overtimeMinutes) : "—"));
      const statusCell = createCell("td", row.status, row.status === "OK" ? "print-status-ok" : "print-status-warning");
      if (row.issues.length) statusCell.title = row.issues.join(" / ");
      tableRow.append(statusCell);
      tbody.append(tableRow);
    });
    table.append(tbody);
  });

  if (!data.groups.length) {
    const tbody = document.createElement("tbody");
    const row = document.createElement("tr");
    const cell = createCell("td", "この月には転記対象のシフトがありません。", "print-empty-message");
    cell.colSpan = 9;
    row.append(cell);
    tbody.append(row);
    table.append(tbody);
  }

  article.append(table);
  const note = document.createElement("p");
  note.className = "print-footnote";
  note.textContent = "「要確認」は休憩不足・勤務時間外の休憩・重複などがある行です。正式登録前に1日チャートで確認してください。";
  article.append(note);
  return article;
}
