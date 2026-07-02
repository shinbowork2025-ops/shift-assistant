import {
  state,
  dayFromDate,
  shiftDurationMinutes,
  timeToMinutes,
  minutesToTime,
  setBreaksForDate
} from "./model.js";
import { plannedBreakTemplates } from "./break-rules.js";
import { buildShiftTypeMap, getShiftCodeFromData } from "./month-overview.js";

const SLOT_MINUTES = 15;

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

function slotRange(start, duration) {
  const slots = [];
  for (let minute = start; minute < start + duration; minute += SLOT_MINUTES) slots.push(minute);
  return slots;
}

function activeWorkersBySlot(assignments) {
  const active = new Map();
  for (const { shiftType } of assignments) {
    const start = timeToMinutes(shiftType.start);
    const end = timeToMinutes(shiftType.end);
    for (let minute = start; minute < end; minute += SLOT_MINUTES) {
      active.set(minute, (active.get(minute) ?? 0) + 1);
    }
  }
  return active;
}

function candidateStarts(target, earliest, latest) {
  const candidates = [];
  for (let offset = -60; offset <= 60; offset += SLOT_MINUTES) {
    const candidate = Math.round((target + offset) / SLOT_MINUTES) * SLOT_MINUTES;
    if (candidate >= earliest && candidate <= latest && !candidates.includes(candidate)) candidates.push(candidate);
  }
  if (candidates.length === 0) {
    const clamped = Math.min(latest, Math.max(earliest, Math.round(target / SLOT_MINUTES) * SLOT_MINUTES));
    candidates.push(clamped);
  }
  return candidates;
}

function chooseBreakStart({ target, earliest, latest, duration, active, breakLoad }) {
  const candidates = candidateStarts(target, earliest, latest);
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const slots = slotRange(candidate, duration);
    const availableAfter = slots.map((slot) => (active.get(slot) ?? 0) - (breakLoad.get(slot) ?? 0) - 1);
    const minimumAvailable = Math.min(...availableAfter);
    const concurrentLoad = slots.reduce((total, slot) => total + (breakLoad.get(slot) ?? 0), 0);
    const deviation = Math.abs(candidate - target);
    const score = (-minimumAvailable * 1000) + (concurrentLoad * 100) + deviation;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function addExistingBreaksToLoad(breaks, breakLoad) {
  for (const breakItem of breaks ?? []) {
    const start = timeToMinutes(breakItem.start);
    const end = timeToMinutes(breakItem.end);
    if (start === null || end === null || end <= start) continue;
    for (const slot of slotRange(start, end - start)) {
      breakLoad.set(slot, (breakLoad.get(slot) ?? 0) + 1);
    }
  }
}

export function generateBreaksForDate(dateValue, employeeIds = null, options = {}) {
  const assignments = workingAssignments(dateValue);
  const active = activeWorkersBySlot(assignments);
  const breakLoad = new Map();
  const targetIds = employeeIds ? new Set(employeeIds) : new Set(assignments.map(({ employee }) => employee.id));
  const result = employeeIds ? structuredClone(state.breaks[dateValue] ?? {}) : {};

  for (const employeeId of targetIds) delete result[employeeId];

  if (employeeIds) {
    for (const { employee } of assignments) {
      if (!targetIds.has(employee.id)) addExistingBreaksToLoad(result[employee.id], breakLoad);
    }
  }

  for (const { employee, shiftType } of assignments) {
    if (!targetIds.has(employee.id)) continue;

    const shiftStart = timeToMinutes(shiftType.start);
    const shiftEnd = timeToMinutes(shiftType.end);
    const templates = plannedBreakTemplates(shiftDurationMinutes(shiftType));
    let previousEnd = shiftStart;
    result[employee.id] = [];

    templates.forEach((template, index) => {
      const target = shiftStart + template.targetOffset;
      const remainingTemplates = templates.slice(index + 1);
      const remainingDuration = remainingTemplates.reduce((sum, item) => sum + item.duration + 60, 0);
      const earliest = Math.max(shiftStart + 60, previousEnd + 60);
      const latest = Math.max(earliest, shiftEnd - template.duration - Math.max(45, remainingDuration));
      const start = chooseBreakStart({
        target,
        earliest,
        latest,
        duration: template.duration,
        active,
        breakLoad
      });
      const end = start + template.duration;

      result[employee.id].push({
        type: template.type,
        label: template.label,
        start: minutesToTime(start),
        end: minutesToTime(end)
      });
      for (const slot of slotRange(start, template.duration)) {
        breakLoad.set(slot, (breakLoad.get(slot) ?? 0) + 1);
      }
      previousEnd = end;
    });
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
