import { state } from "./model.js";
import { buildMonthOverview } from "./month-overview.js";
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

  const overview = buildMonthOverview({
    monthValue: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts
  });
  const table = document.createElement("table");
  table.className = "schedule-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.append(createHeaderCell("従業員", "employee-column"));

  for (const dayInfo of overview.days) {
    const cell = document.createElement("th");
    cell.className = weekendClass(dayInfo.weekday);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "day-view-button";
    button.dataset.day = String(dayInfo.day);
    button.textContent = `${dayInfo.day} ${dayInfo.label}`;
    button.title = `${dayInfo.day}日の時間帯チャートを開く`;
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
  for (const { employee, cells, summary } of overview.employeeRows) {
    const row = document.createElement("tr");
    const employeeCell = document.createElement("th");
    employeeCell.scope = "row";
    employeeCell.className = "employee-column";
    const employeeButton = document.createElement("button");
    employeeButton.type = "button";
    employeeButton.className = "employee-button";
    employeeButton.dataset.employeeId = employee.id;
    employeeButton.append(document.createTextNode(employee.name));
    const fixedOvertimeLabel = `固定残業${formatHours(summary.fixedOvertimeHours)}`;
    const details = [employee.code, employee.department, fixedOvertimeLabel].filter(Boolean).join(" / ");
    const code = document.createElement("span");
    code.className = "employee-code";
    code.textContent = details;
    employeeButton.append(code);
    employeeCell.append(employeeButton);
    row.append(employeeCell);

    cells.forEach((cellData, index) => {
      const dayInfo = overview.days[index];
      const cell = document.createElement("td");
      cell.className = [weekendClass(dayInfo.weekday), "paint-cell"].filter(Boolean).join(" ");
      cell.dataset.employeeId = employee.id;
      cell.dataset.day = String(dayInfo.day);
      cell.append(createShiftSelect(employee, dayInfo.day, cellData.code));
      row.append(cell);
    });

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
  for (const summary of overview.daySummaries) {
    workerRow.append(createDataCell(`${summary.workers}人`, weekendClass(summary.weekday)));
  }
  for (let index = 0; index < 4; index += 1) workerRow.append(createDataCell("", "summary-column"));
  tfoot.append(workerRow);

  const overtimeRow = document.createElement("tr");
  overtimeRow.append(createHeaderCell("残業見込", "employee-column"));
  for (const summary of overview.daySummaries) {
    overtimeRow.append(createDataCell(formatHours(summary.overtimeMinutes / 60), weekendClass(summary.weekday)));
  }
  for (let index = 0; index < 4; index += 1) overtimeRow.append(createDataCell("", "summary-column"));
  tfoot.append(overtimeRow);

  table.append(tfoot);
  elements.tableContainer.replaceChildren(table);
}
