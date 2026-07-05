import {
  state,
  dayFromDate,
  timeToMinutes,
  setBreaksForDate
} from "./model.js";
import { buildGreedyBreaks, optimizeBreaks } from "./optimizer.js";
import { buildShiftTypeMap, getShiftCodeFromData } from "./month-overview.js";

function workingAssignments(dateValue) {
  const monthValue = dateValue.slice(0, 7);
  const day = dayFromDate(dateValue);
  const shiftTypesByCode = buildShiftTypeMap(state.shiftTypes);
  return state.employees
    .map((employee) => {
      const shiftCode = getShiftCodeFromData(state.shifts, monthValue, employee.id, day);
      const shiftType = shiftTypesByCode.get(shiftCode) ?? null;
      return { employee, shiftCode, shiftType };
    })
    .filter((assignment) => assignment.shiftType?.isWork)
    .sort((a, b) => {
      const startDifference = timeToMinutes(a.shiftType.start) - timeToMinutes(b.shiftType.start);
      return startDifference || a.employee.order - b.employee.order || a.employee.name.localeCompare(b.employee.name, "ja");
    });
}

export function generateBreaksForDate(dateValue, employeeIds = null, options = {}) {
  const assignments = workingAssignments(dateValue);
  const targetIds = employeeIds ? new Set(employeeIds) : new Set(assignments.map(({ employee }) => employee.id));
  const existingBreaks = structuredClone(state.breaks[dateValue] ?? {});
  const initialBreaks = buildGreedyBreaks(assignments, existingBreaks, [...targetIds], options.optimizerConfig);
  const optimized = optimizeBreaks({
    assignments,
    existingBreaks,
    initialBreaks,
    targetEmployeeIds: [...targetIds]
  }, options.optimizerConfig);
  const result = optimized.breaks;
  if (!employeeIds) {
    const workingIds = new Set(assignments.map(({ employee }) => employee.id));
    for (const employeeId of Object.keys(result)) {
      if (!workingIds.has(employeeId)) delete result[employeeId];
    }
  }

  setBreaksForDate(dateValue, result, { save: options.save !== false });
  return result;
}

// 旧データを開いただけでは休憩を再配置しない。
// 不足や不正な配置は画面側の検証警告で知らせ、再配置はユーザー操作で行う。
export function ensureBreaksForDate(dateValue) {
  return state.breaks[dateValue] ?? {};
}

export function availableWorkersAt(dateValue, slotStart) {
  const monthValue = dateValue.slice(0, 7);
  const day = dayFromDate(dateValue);
  const shiftTypesByCode = buildShiftTypeMap(state.shiftTypes);
  let count = 0;
  for (const employee of state.employees) {
    const shiftCode = getShiftCodeFromData(state.shifts, monthValue, employee.id, day);
    const shiftType = shiftTypesByCode.get(shiftCode) ?? null;
    if (!shiftType?.isWork) continue;
    const start = timeToMinutes(shiftType.start);
    const end = timeToMinutes(shiftType.end);
    if (slotStart < start || slotStart >= end) continue;

    const isOnBreak = (state.breaks[dateValue]?.[employee.id] ?? []).some((breakItem) => {
      const breakStart = timeToMinutes(breakItem.start);
      const breakEnd = timeToMinutes(breakItem.end);
      return slotStart >= breakStart && slotStart < breakEnd;
    });
    if (!isOnBreak) count += 1;
  }
  return count;
}
