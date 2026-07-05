import { dayFromDate, minutesToTime, timeToMinutes } from "./date-time.js";
import { buildShiftTypeMap, getShiftCodeFromData } from "./month-overview.js";
import { generateGreedyRestPlan } from "./rest-greedy.js";

function numericItem(item) {
  const start = timeToMinutes(item?.start);
  const end = timeToMinutes(item?.end);
  if (start === null || end === null || end <= start) return null;
  return {
    type: item.type ?? (end - start <= 15 ? "small" : "lunch"),
    label: item.label ?? (end - start <= 15 ? "小休憩" : "昼休憩"),
    start,
    end,
    target: Number.isFinite(Number(item.target)) ? Number(item.target) : start,
    locked: Boolean(item.locked)
  };
}

export function buildOptimizerInput({ dateValue, employees = [], shiftTypes = [], shifts = {}, breaks = {} }) {
  const monthValue = dateValue.slice(0, 7);
  const day = dayFromDate(dateValue);
  const typeMap = buildShiftTypeMap(shiftTypes);
  const planEmployees = [];

  for (const employee of employees) {
    const shiftCode = getShiftCodeFromData(shifts, monthValue, employee.id, day);
    const shiftType = typeMap.get(shiftCode);
    if (!shiftType?.isWork) continue;
    const shiftStart = timeToMinutes(shiftType.start);
    const shiftEnd = timeToMinutes(shiftType.end);
    if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart) continue;
    planEmployees.push({
      id: employee.id,
      name: employee.name,
      order: employee.order,
      employmentType: employee.employmentType,
      shiftCode,
      shiftStart,
      shiftEnd,
      breaks: (breaks?.[dateValue]?.[employee.id] ?? []).map(numericItem).filter(Boolean)
    });
  }
  return { dateValue, employees: planEmployees };
}

export function addGreedyInitialSolution(dayPlan) {
  const generated = generateGreedyRestPlan(dayPlan);
  return {
    ...dayPlan,
    employees: dayPlan.employees.map((employee) => ({
      ...employee,
      breaks: (generated[employee.id] ?? []).map((item) => ({ ...item }))
    }))
  };
}

export function formatOptimizerOutput(numericMap) {
  return Object.fromEntries(Object.entries(numericMap ?? {}).map(([employeeId, items]) => [
    employeeId,
    (items ?? []).map((item) => ({
      type: item.type,
      label: item.label,
      start: minutesToTime(Number(item.start)),
      end: minutesToTime(Number(item.end)),
      locked: Boolean(item.locked)
    }))
  ]));
}
