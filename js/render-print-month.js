import { buildMonthlyPrintData, formatDuration } from "./print-data.js";
import { createCell, createDocumentHeader, printWeekendClass } from "./render-print-common.js";

export function renderMonthlyPrintDocument(workspace, printedAt) {
  const data = buildMonthlyPrintData(workspace);
  const article = document.createElement("article");
  article.className = "print-document print-month-document";
  article.append(createDocumentHeader(workspace, data.monthValue, printedAt, "月間シフト一覧"));

  const table = document.createElement("table");
  table.className = "print-month-table";
  const colgroup = document.createElement("colgroup");
  const employeeCol = document.createElement("col");
  employeeCol.className = "print-month-employee-col";
  colgroup.append(employeeCol);
  data.days.forEach(() => {
    const col = document.createElement("col");
    col.className = "print-month-day-col";
    colgroup.append(col);
  });
  ["workdays", "hours", "overtime"].forEach((name) => {
    const col = document.createElement("col");
    col.className = `print-month-summary-col print-month-${name}-col`;
    colgroup.append(col);
  });
  table.append(colgroup);

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.append(createCell("th", "従業員", "print-employee-header"));
  data.days.forEach((day) => {
    const cell = createCell("th", "", `print-day-header ${printWeekendClass(day.weekday)}`);
    const dayNumber = document.createElement("span");
    dayNumber.textContent = String(day.day);
    const weekday = document.createElement("small");
    weekday.textContent = day.weekdayLabel;
    cell.append(dayNumber, weekday);
    headerRow.append(cell);
  });
  headerRow.append(createCell("th", "勤務日", "print-summary-header"));
  headerRow.append(createCell("th", "実働", "print-summary-header"));
  headerRow.append(createCell("th", "残業", "print-summary-header"));
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  data.rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    const employeeCell = createCell("th", "", "print-employee-cell");
    const name = document.createElement("strong");
    name.textContent = row.name;
    const detail = document.createElement("small");
    detail.textContent = [row.code, row.department].filter(Boolean).join(" / ");
    employeeCell.append(name);
    if (detail.textContent) employeeCell.append(detail);
    tableRow.append(employeeCell);

    row.cells.forEach((cell, index) => {
      const day = data.days[index];
      tableRow.append(createCell("td", cell.label, `print-shift-cell ${printWeekendClass(day.weekday)}`));
    });
    tableRow.append(createCell("td", `${row.workDays}`, "print-summary-cell"));
    tableRow.append(createCell("td", formatDuration(row.paidMinutes), "print-summary-cell"));
    tableRow.append(createCell("td", formatDuration(row.overtimeMinutes), "print-summary-cell"));
    tbody.append(tableRow);
  });
  table.append(tbody);
  article.append(table);

  const legend = document.createElement("section");
  legend.className = "print-legend";
  const legendTitle = document.createElement("h2");
  legendTitle.textContent = "シフト略称";
  const list = document.createElement("div");
  list.className = "print-legend-list";
  data.legend.forEach((item) => {
    const entry = document.createElement("span");
    const overtime = item.overtimeMinutes > 0 ? `・残業${formatDuration(item.overtimeMinutes)}` : "";
    entry.textContent = `${item.label}＝${item.name}${item.time ? ` ${item.time}` : ""}${overtime}`;
    list.append(entry);
  });
  legend.append(legendTitle, list);
  article.append(legend);
  return article;
}
