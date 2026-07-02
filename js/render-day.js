import { state } from "./model.js";
import { buildDailyOverview } from "./daily-overview.js";
import {
  shiftToneClass,
  createHeaderCell,
  createDataCell,
  createShiftSelect
} from "./render-common.js";

function validationMessage(validation) {
  const summary = `実働${validation.work}分 / 休憩${validation.actual}分 / 必要${validation.required}分`;
  return [summary, ...validation.issues].join("\n");
}

function timelineClass(cell) {
  if (cell.kind === "work") return `timeline-work ${shiftToneClass(cell.shiftCode)}`;
  if (cell.kind === "break") {
    return cell.breakType === "lunch"
      ? "timeline-break timeline-lunch"
      : "timeline-break timeline-small-break";
  }
  return "timeline-off";
}

export function renderDailyTable(elements) {
  const overview = buildDailyOverview({
    dateValue: state.selectedDate,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    breaks: state.breaks
  });
  const table = document.createElement("table");
  table.className = "daily-chart-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.append(createHeaderCell("従業員", "daily-employee-column"));
  headerRow.append(createHeaderCell("シフト", "daily-select-column"));
  for (const slot of overview.slots) {
    const cell = createHeaderCell(slot % 60 === 0 ? `${String(Math.floor(slot / 60)).padStart(2, "0")}:00` : "", "timeline-header-cell");
    if (slot % 60 === 0) cell.classList.add("hour-start");
    headerRow.append(cell);
  }
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const rowData of overview.rows) {
    const { employee, shiftCode, validation, cells } = rowData;
    const row = document.createElement("tr");
    if (!validation.ok) row.classList.add("break-invalid-row");

    const nameCell = document.createElement("th");
    nameCell.scope = "row";
    nameCell.className = "daily-employee-column";
    nameCell.append(document.createTextNode(employee.name));
    if (!validation.ok) {
      const warning = document.createElement("span");
      warning.className = "break-warning";
      warning.textContent = "⚠ 休憩確認";
      warning.title = validationMessage(validation);
      warning.setAttribute("aria-label", `休憩確認: ${validationMessage(validation)}`);
      nameCell.append(warning);
    }
    row.append(nameCell);

    const selectCell = document.createElement("td");
    selectCell.className = "daily-select-column";
    if (!validation.ok) selectCell.title = validationMessage(validation);
    selectCell.append(createShiftSelect(employee, overview.day, shiftCode, true));
    row.append(selectCell);

    cells.forEach((cellData, index) => {
      const slot = overview.slots[index];
      const cell = document.createElement("td");
      cell.className = `timeline-cell ${timelineClass(cellData)}`;
      if (!validation.ok && cellData.kind === "work") cell.classList.add("timeline-break-invalid");
      if (slot % 60 === 0) cell.classList.add("hour-start");
      if (cellData.title) cell.title = cellData.title;
      row.append(cell);
    });
    tbody.append(row);
  }
  table.append(tbody);

  const tfoot = document.createElement("tfoot");
  const coverageRow = document.createElement("tr");
  coverageRow.append(createHeaderCell("実配置人数", "daily-employee-column"));
  coverageRow.append(createDataCell("休憩除外", "daily-select-column"));
  overview.coverage.forEach((count, index) => {
    const slot = overview.slots[index];
    const className = count === 0 ? "coverage-zero" : count === 1 ? "coverage-low" : "coverage-ok";
    const cell = createDataCell(String(count), `coverage-cell ${className}`);
    if (slot % 60 === 0) cell.classList.add("hour-start");
    cell.title = `${Math.floor(slot / 60)}:${String(slot % 60).padStart(2, "0")} 実配置${count}人`;
    coverageRow.append(cell);
  });
  tfoot.append(coverageRow);
  table.append(tfoot);

  elements.dailyChartContainer.replaceChildren(table);
  elements.dailyEmptyState.hidden = state.employees.length > 0;
  elements.dailyChartContainer.hidden = state.employees.length === 0;
}
