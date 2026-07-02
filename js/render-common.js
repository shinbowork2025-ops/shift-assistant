import { state } from "./model.js";

export function weekendClass(weekday) {
  if (weekday === 0) return "weekend-sunday";
  if (weekday === 6) return "weekend-saturday";
  return "";
}

export function shiftToneClass(code) {
  const index = state.shiftTypes.findIndex((shift) => shift.code === code);
  return index >= 0 ? `shift-tone-${index % 8}` : "";
}

export function createHeaderCell(text, className = "") {
  const cell = document.createElement("th");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

export function createDataCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

export function formatHours(hours) {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function formatMinutesAsHours(minutes) {
  return formatHours((Number(minutes) || 0) / 60);
}

function shiftDisplayText(shiftType) {
  if (!shiftType.isWork) return shiftType.name;
  const overtime = Number(shiftType.overtimeMinutes) > 0
    ? `・残業${formatMinutesAsHours(shiftType.overtimeMinutes)}`
    : "";
  return `${shiftType.name} ${shiftType.start}〜${shiftType.end}${overtime}`;
}

export function createShiftSelect(employee, day, currentCode, compact = false) {
  const select = document.createElement("select");
  select.className = `shift-select ${shiftToneClass(currentCode)}`;
  if (compact) select.classList.add("daily-shift-select");
  select.dataset.shift = currentCode;
  select.dataset.employeeId = employee.id;
  select.dataset.day = String(day);
  select.setAttribute("aria-label", `${employee.name} ${day}日 勤務区分`);

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "未入力";
  select.append(emptyOption);
  for (const shiftType of state.shiftTypes) {
    const option = document.createElement("option");
    option.value = shiftType.code;
    option.textContent = shiftDisplayText(shiftType);
    select.append(option);
  }
  select.value = currentCode;
  return select;
}

export function renderLegend(elements) {
  const fragment = document.createDocumentFragment();
  state.shiftTypes.forEach((shiftType, index) => {
    const item = document.createElement("div");
    const swatch = document.createElement("span");
    swatch.className = `swatch shift-tone-${index % 8}`;
    item.append(swatch, document.createTextNode(shiftDisplayText(shiftType)));
    fragment.append(item);
  });
  elements.legend.replaceChildren(fragment);
}
