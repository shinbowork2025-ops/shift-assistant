import {
  state,
  dayFromDate,
  getShift,
  getShiftType,
  shiftDurationMinutes,
  timeToMinutes,
  minutesToTime,
  setBreaksForDate
} from "./model.js";

const SLOT_MINUTES = 15;

function breakTemplates(shiftType) {
  const duration = shiftDurationMinutes(shiftType);
  if (duration >= 480) {
    return [
      { type: "small", label: "小休憩", duration: 15, targetOffset: 120 },
      { type: "lunch", label: "昼休憩", duration: 60, targetOffset: 255 },
      { type: "small", label: "小休憩", duration: 15, targetOffset: 435 }
    ];
  }
  if (duration >= 240) {
    return [{ type: "small", label: "小休憩", duration: 15, targetOffset: 120 }];
  }
  return [];
}

function workingAssignments(dateValue) {
  const day = dayFromDate(dateValue);
  return state.employees
    .map((employee) => {
      const shiftCode = getShift(employee.id, day);
      const shiftType = getShiftType(shiftCode);
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

export function generateBreaksForDate(dateValue) {
  const assignments = workingAssignments(dateValue);
  const active = activeWorkersBySlot(assignments);
  const breakLoad = new Map();
  const result = {};

  for (const { employee, shiftType } of assignments) {
    const shiftStart = timeToMinutes(shiftType.start);
    const shiftEnd = timeToMinutes(shiftType.end);
    const templates = breakTemplates(shiftType);
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

  setBreaksForDate(dateValue, result);
  return result;
}

export function ensureBreaksForDate(dateValue) {
  const dayBreaks = state.breaks[dateValue];
  const assignments = workingAssignments(dateValue);
  const expectedIds = assignments.map(({ employee }) => employee.id).sort();
  const currentIds = dayBreaks ? Object.keys(dayBreaks).sort() : [];
  const isCurrent = expectedIds.length === currentIds.length && expectedIds.every((id, index) => id === currentIds[index]);
  return isCurrent ? dayBreaks : generateBreaksForDate(dateValue);
}

export function availableWorkersAt(dateValue, slotStart) {
  const day = dayFromDate(dateValue);
  let count = 0;
  for (const employee of state.employees) {
    const shiftType = getShiftType(getShift(employee.id, day));
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
