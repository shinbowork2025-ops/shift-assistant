import {
  state,
  getShift,
  getShiftType,
  getBreaks,
  dayFromDate,
  timeToMinutes
} from "./model.js";
import { availableWorkersAt } from "./breaks.js";
import {
  shiftToneClass,
  createHeaderCell,
  createDataCell,
  createShiftSelect
} from "./render-common.js";

const SLOT_MINUTES = 15;

function timelineRange(day) {
  const starts = [];
  const ends = [];
  for (const employee of state.employees) {
    const shiftType = getShiftType(getShift(employee.id, day));
    if (!shiftType?.isWork) continue;
    starts.push(timeToMinutes(shiftType.start));
    ends.push(timeToMinutes(shiftType.end));
  }
  const start = starts.length ? Math.max(0, Math.floor(Math.min(...starts) / 60) * 60) : 8 * 60;
  const end = ends.length ? Math.min(24 * 60, Math.ceil(Math.max(...ends) / 60) * 60) : 22 * 60;
  return { start, end: Math.max(start + 60, end) };
}

function buildSlots(start, end) {
  const slots = [];
  for (let minute = start; minute < end; minute += SLOT_MINUTES) slots.push(minute);
  return slots;
}

function slotStatus(employeeId, day, slotStart) {
  const shiftType = getShiftType(getShift(employeeId, day));
  if (!shiftType?.isWork) return { className: "timeline-off", title: "" };
  const shiftStart = timeToMinutes(shiftType.start);
  const shiftEnd = timeToMinutes(shiftType.end);
  if (slotStart < shiftStart || slotStart >= shiftEnd) return { className: "timeline-off", title: "" };

  const breakItem = getBreaks(employeeId, state.selectedDate).find((item) => {
    const breakStart = timeToMinutes(item.start);
    const breakEnd = timeToMinutes(item.end);
    return slotStart >= breakStart && slotStart < breakEnd;
  });
  if (breakItem) {
    const className = breakItem.type === "lunch" ? "timeline-break timeline-lunch" : "timeline-break timeline-small-break";
    return { className, title: `${breakItem.label} ${breakItem.start}〜${breakItem.end}` };
  }
  return { className: `timeline-work ${shiftToneClass(shiftType.code)}`, title: `${shiftType.name} ${shiftType.start}〜${shiftType.end}` };
}

export function renderDailyTable(elements) {
  const day = dayFromDate(state.selectedDate);
  const { start, end } = timelineRange(day);
  const slots = buildSlots(start, end);
  const table = document.createElement("table");
  table.className = "daily-chart-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.append(createHeaderCell("従業員", "daily-employee-column"));
  headerRow.append(createHeaderCell("シフト", "daily-select-column"));
  for (const slot of slots) {
    const cell = createHeaderCell(slot % 60 === 0 ? `${String(Math.floor(slot / 60)).padStart(2, "0")}:00` : "", "timeline-header-cell");
    if (slot % 60 === 0) cell.classList.add("hour-start");
    headerRow.append(cell);
  }
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const employee of state.employees) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("th");
    nameCell.scope = "row";
    nameCell.className = "daily-employee-column";
    nameCell.textContent = employee.name;
    row.append(nameCell);

    const selectCell = document.createElement("td");
    selectCell.className = "daily-select-column";
    selectCell.append(createShiftSelect(employee, day, getShift(employee.id, day), true));
    row.append(selectCell);

    for (const slot of slots) {
      const status = slotStatus(employee.id, day, slot);
      const cell = document.createElement("td");
      cell.className = `timeline-cell ${status.className}`;
      if (slot % 60 === 0) cell.classList.add("hour-start");
      if (status.title) cell.title = status.title;
      row.append(cell);
    }
    tbody.append(row);
  }
  table.append(tbody);

  const tfoot = document.createElement("tfoot");
  const coverageRow = document.createElement("tr");
  coverageRow.append(createHeaderCell("実配置人数", "daily-employee-column"));
  coverageRow.append(createDataCell("休憩除外", "daily-select-column"));
  for (const slot of slots) {
    const count = availableWorkersAt(state.selectedDate, slot);
    const className = count === 0 ? "coverage-zero" : count === 1 ? "coverage-low" : "coverage-ok";
    const cell = createDataCell(String(count), `coverage-cell ${className}`);
    if (slot % 60 === 0) cell.classList.add("hour-start");
    cell.title = `${Math.floor(slot / 60)}:${String(slot % 60).padStart(2, "0")} 実配置${count}人`;
    coverageRow.append(cell);
  }
  tfoot.append(coverageRow);
  table.append(tfoot);

  elements.dailyChartContainer.replaceChildren(table);
  elements.dailyEmptyState.hidden = state.employees.length > 0;
  elements.dailyChartContainer.hidden = state.employees.length === 0;
}
