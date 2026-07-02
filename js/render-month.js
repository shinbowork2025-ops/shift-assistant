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
  headerRow.append(createHeaderCell("残業見込", "summary-column"));
  headerRow.append(createHeaderCell("固定残業残", "summary-column"));
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
    const fixedOvertimeLabel = `固定残業${formatHours((employee.fixedOvertimeMinutes ?? 0) / 60)}`;
    const details = [employee.code, employee.department, fixedOvertimeLabel].filter(Boolean).join(" / ");
    const code = document.createElement("span");
    code.className = "employee-code";
    code.textContent = details;
    employeeButton.append(code);
    employeeCell.append(employeeButton);
    row.append(employeeCell);

    for (let day = 1; day <= numberOfDays; day += 1) {
      const dayInfo = getDayInfo(state.selectedMonth, day);
      const cell = document.createElement("td");
      cell.className = [weekendClass(dayInfo.weekday), "paint-cell"].filter(Boolean).join(" ");
      cell.dataset.employeeId = employee.id;
      cell.dataset.day = String(day);
      cell.append(createShiftSelect(employee, day, getShift(employee.id, day)));
      row.append(cell);
    }

    const summary = employeeSummary(employee.id);
    const remainingText = summary.overtimeRemainingHours >= 0
      ? formatHours(summary.overtimeRemainingHours)
      : `超過${formatHours(Math.abs(summary.overtimeRemainingHours))}`;
    const remainingClass = summary.overtimeRemainingHours < 0
      ? "summary-column overtime-over"
      : "summary-column";
    row.append(createDataCell(`${summary.workDays}日`, "summary-column"));
    row.append(createDataCell(formatHours(summary.hours), "summary-column"));
    row.append(createDataCell(formatHours(summary.overtimeHours), "summary-column"));
    row.append(createDataCell(remainingText, remainingClass));
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
  for (let index = 0; index < 4; index += 1) workerRow.append(createDataCell("", "summary-column"));
  tfoot.append(workerRow);

  const overtimeRow = document.createElement("tr");
  overtimeRow.append(createHeaderCell("残業見込", "employee-column"));
  for (let day = 1; day <= numberOfDays; day += 1) {
    const dayInfo = getDayInfo(state.selectedMonth, day);
    overtimeRow.append(createDataCell(formatHours(daySummary(day).overtimeHours), weekendClass(dayInfo.weekday)));
  }
  for (let index = 0; index < 4; index += 1) overtimeRow.append(createDataCell("", "summary-column"));
  tfoot.append(overtimeRow);

  table.append(tfoot);
  elements.tableContainer.replaceChildren(table);
}
