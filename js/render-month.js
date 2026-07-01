import {
  state,
  getDaysInMonth,
  getDayInfo,
  getShift,
  employeeSummary,
  daySummary
} from "./model.js";
import {
  weekendClass,
  createHeaderCell,
  createDataCell,
  formatHours,
  createShiftSelect
} from "./render-common.js";

export function renderMonthTable(elements) {
  const hasEmployees = state.employees.length > 0;
  elements.emptyState.hidden = hasEmployees;
  elements.tableContainer.hidden = !hasEmployees;
  elements.exportCsvButton.disabled = !hasEmployees;
  elements.clearMonthButton.disabled = !state.shifts[state.selectedMonth];

  if (!hasEmployees) {
    elements.tableContainer.replaceChildren();
    return;
  }

  const numberOfDays = getDaysInMonth(state.selectedMonth);
  const table = document.createElement("table");
  table.className = "schedule-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.append(createHeaderCell("従業員", "employee-column"));

  for (let day = 1; day <= numberOfDays; day += 1) {
    const dayInfo = getDayInfo(state.selectedMonth, day);
    const cell = document.createElement("th");
    cell.className = weekendClass(dayInfo.weekday);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "day-view-button";
    button.dataset.day = String(day);
    button.textContent = `${day} ${dayInfo.label}`;
    button.title = `${day}日の時間帯チャートを開く`;
    cell.append(button);
    headerRow.append(cell);
  }
  headerRow.append(createHeaderCell("勤務日", "summary-column"));
  headerRow.append(createHeaderCell("実働", "summary-column"));
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const employee of state.employees) {
    const row = document.createElement("tr");
    const employeeCell = document.createElement("th");
    employeeCell.scope = "row";
    employeeCell.className = "employee-column";
    const employeeButton = document.createElement("button");
    employeeButton.type = "button";
    employeeButton.className = "employee-button";
    employeeButton.dataset.employeeId = employee.id;
    employeeButton.append(document.createTextNode(employee.name));
    const details = [employee.code, employee.department].filter(Boolean).join(" / ");
    if (details) {
      const code = document.createElement("span");
      code.className = "employee-code";
      code.textContent = details;
      employeeButton.append(code);
    }
    employeeCell.append(employeeButton);
    row.append(employeeCell);

    for (let day = 1; day <= numberOfDays; day += 1) {
      const dayInfo = getDayInfo(state.selectedMonth, day);
      const cell = document.createElement("td");
      cell.className = weekendClass(dayInfo.weekday);
      cell.append(createShiftSelect(employee, day, getShift(employee.id, day)));
      row.append(cell);
    }

    const summary = employeeSummary(employee.id);
    row.append(createDataCell(`${summary.workDays}日`, "summary-column"));
    row.append(createDataCell(formatHours(summary.hours), "summary-column"));
    tbody.append(row);
  }
  table.append(tbody);

  const tfoot = document.createElement("tfoot");
  const workerRow = document.createElement("tr");
  workerRow.append(createHeaderCell("出勤人数", "employee-column"));
  for (let day = 1; day <= numberOfDays; day += 1) {
    const dayInfo = getDayInfo(state.selectedMonth, day);
    workerRow.append(createDataCell(`${daySummary(day).workers}人`, weekendClass(dayInfo.weekday)));
  }
  workerRow.append(createDataCell("", "summary-column"));
  workerRow.append(createDataCell("", "summary-column"));
  tfoot.append(workerRow);
  table.append(tfoot);
  elements.tableContainer.replaceChildren(table);
}
