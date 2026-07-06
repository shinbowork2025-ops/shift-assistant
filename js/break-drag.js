import { minutesToTime, timeToMinutes } from "./date-time.js";

const SLOT_MINUTES = 15;

function normalizeMinute(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number / SLOT_MINUTES) * SLOT_MINUTES;
}

function breakDuration(breakItem) {
  const start = timeToMinutes(breakItem?.start);
  const end = timeToMinutes(breakItem?.end);
  if (start === null || end === null || end <= start) return null;
  return end - start;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

export function moveBreakToStart({ breaks = [], breakIndex, newStartMinute, shiftType }) {
  const index = Number(breakIndex);
  if (!Number.isInteger(index) || index < 0 || index >= breaks.length) {
    return { ok: false, message: "移動する休憩が見つかりません。" };
  }

  const duration = breakDuration(breaks[index]);
  if (duration === null) return { ok: false, message: "休憩の開始・終了時刻が正しくありません。" };
  const before = { start: breaks[index].start, end: breaks[index].end };

  const shiftStart = timeToMinutes(shiftType?.start);
  const shiftEnd = timeToMinutes(shiftType?.end);
  const start = normalizeMinute(newStartMinute);
  if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart || start === null) {
    return { ok: false, message: "勤務時間内の移動先を選んでください。" };
  }

  const end = start + duration;
  if (start < shiftStart || end > shiftEnd) {
    return { ok: false, message: "休憩は勤務時間内に収まる位置へ移動してください。" };
  }

  for (let otherIndex = 0; otherIndex < breaks.length; otherIndex += 1) {
    if (otherIndex === index) continue;
    const otherStart = timeToMinutes(breaks[otherIndex]?.start);
    const otherEnd = timeToMinutes(breaks[otherIndex]?.end);
    if (otherStart === null || otherEnd === null || otherEnd <= otherStart) continue;
    if (overlaps(start, end, otherStart, otherEnd)) {
      return { ok: false, message: "他の休憩と重ならない位置へ移動してください。" };
    }
  }

  const nextBreaks = breaks.map((breakItem, itemIndex) => (
    itemIndex === index
      ? { ...breakItem, start: minutesToTime(start), end: minutesToTime(end) }
      : { ...breakItem }
  )).sort((a, b) => (timeToMinutes(a.start) ?? 0) - (timeToMinutes(b.start) ?? 0));

  const after = { start: minutesToTime(start), end: minutesToTime(end) };
  return { ok: true, breaks: nextBreaks, before, after };
}
