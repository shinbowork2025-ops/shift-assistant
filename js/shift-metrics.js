import { plannedBreakMinutes } from "./break-rules.js";
import { timeToMinutes } from "./date-time.js";
import { mergedIntervalMinutes } from "./intervals.js";

export { mergedIntervalMinutes };

export function nonNegativeMinutes(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

export function shiftDurationMinutes(shiftType) {
  if (!shiftType?.isWork) return 0;
  const start = timeToMinutes(shiftType.start);
  const end = timeToMinutes(shiftType.end);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

export function expectedBreakMinutes(shiftType) {
  return plannedBreakMinutes(shiftDurationMinutes(shiftType));
}

export function overtimeMinutesForShift(shiftType) {
  return shiftType ? nonNegativeMinutes(shiftType.overtimeMinutes) : 0;
}

export function breakMinutesWithinShift(shiftType, breaks = []) {
  if (!shiftType?.isWork) return 0;
  const shiftStart = timeToMinutes(shiftType.start);
  const shiftEnd = timeToMinutes(shiftType.end);
  if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart) return 0;

  const intervals = breaks.map((breakItem) => {
    const start = timeToMinutes(breakItem?.start);
    const end = timeToMinutes(breakItem?.end);
    if (start === null || end === null || end <= start) return null;
    const clippedStart = Math.max(start, shiftStart);
    const clippedEnd = Math.min(end, shiftEnd);
    return clippedEnd > clippedStart ? { start: clippedStart, end: clippedEnd } : null;
  }).filter(Boolean);

  return mergedIntervalMinutes(intervals);
}

export function paidMinutesForShift(shiftType, options = {}) {
  if (!shiftType) return 0;
  if (Number.isFinite(Number(shiftType.paidMinutes))) return Math.max(0, Number(shiftType.paidMinutes));
  if (!shiftType.isWork) return 0;

  const span = shiftDurationMinutes(shiftType);
  const breakMinutes = Number.isFinite(Number(options.breakMinutes))
    ? Math.max(0, Number(options.breakMinutes))
    : Array.isArray(options.breaks)
      ? breakMinutesWithinShift(shiftType, options.breaks)
      : expectedBreakMinutes(shiftType);
  return Math.max(0, span - breakMinutes);
}

export function formatDurationMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
