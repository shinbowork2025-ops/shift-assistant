import { SLOT_MINUTES } from "./solver-config.js";

function minuteValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isDayOffShift(shiftType) {
  return Boolean(shiftType?.isDayOff ?? shiftType?.isWork === false);
}

export function spanMinutes(shiftType) {
  if (!shiftType || isDayOffShift(shiftType)) return 0;
  return Math.max(0, minuteValue(shiftType.endMinutes) - minuteValue(shiftType.startMinutes));
}

export function plannedBreakMinutes(shiftType) {
  if (!shiftType || isDayOffShift(shiftType)) return 0;
  return Math.max(0, minuteValue(shiftType.breakPolicy?.totalMinutes));
}

export function scheduledWorkMinutes(shiftType) {
  return Math.max(0, spanMinutes(shiftType) - plannedBreakMinutes(shiftType));
}

export function payableMinutes(shiftType) {
  if (!shiftType || isDayOffShift(shiftType)) return 0;
  const explicit = Number(shiftType.paidMinutes);
  return Number.isFinite(explicit) && explicit >= 0 ? explicit : scheduledWorkMinutes(shiftType);
}

export function overtimeMinutes(shiftType) {
  if (!shiftType || isDayOffShift(shiftType)) return 0;
  return Math.max(0, minuteValue(shiftType.overtimeMinutes));
}

export function minutesToSlot(minutes) {
  return Math.floor(minuteValue(minutes) / SLOT_MINUTES);
}

export function slotToMinutes(slot) {
  return minuteValue(slot) * SLOT_MINUTES;
}
