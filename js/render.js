import {
  state,
  getDaysInMonth,
  getDayInfo,
  getShift,
  employeeSummary,
  daySummary,
  monthDisplayName
} from "./model.js";

function weekendClass(weekday) {
  if (weekday === 0) return "weekend-sunday";
  if (weekday === 6) return "weekend-saturday";
  return "";
}

function createHeaderCell(text, className = "") {
  const cell = document.createElement("th");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function createDataCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

export function render(elements) {
  elements.monthInput.value = state.selectedMonth;
  elements.scheduleTitle.textContent = `${monthDisplayName(state.selectedMonth)} シフト表`;
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
    headerRow.append(createHeaderCell(`${day} ${dayInfo.label}`, weekendClass(dayInfo.weekday)));
  }
  headerRow.append(createHeaderCell("勤務日", "summary-column"));
  headerRow.append(createHeaderCell("時間", "summary-column"));
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
    if (employee.code) {
      const code = document.createElement("span");
      code.className = "employee-code";
      code.textContent = employee.code;
      employeeButton.append(code);
    }
    employeeCell.append(employeeButton);
    row.append(employeeCell);

    for (let day = 1; day <= numberOfDays; day += 1) {
      const dayInfo = getDayInfo(state.selectedMonth, day);
      const cell = document.createElement("td");
      cell.className = weekendClass(dayInfo.weekday);
      const select = elements.shiftSelectTemplate.content.firstElementChild.cloneNode(true);
      const shiftValue = getShift(employee.id, day);
      select.value = shiftValue;
      select.dataset.shift = shiftValue;
      select.dataset.employeeId = employee.id;
      select.dataset.day = String(day);
      select.setAttribute("aria-label", `${employee.name} ${day}日 勤務区分`);
      cell.append(select);
      row.append(cell);
    }

    const summary = employeeSummary(employee.id);
    row.append(createDataCell(`${summary.workDays}日`, "summary-column"));
    row.append(createDataCell(`${summary.hours}h`, "summary-column"));
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
