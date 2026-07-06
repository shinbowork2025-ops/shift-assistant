import { timeToMinutes } from "./date-time.js";
import { mergedIntervalMinutes } from "./intervals.js";

const MINUTES_PER_DAY = 24 * 60;

function normalizeMinute(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

export function requiredBreakMinutes(workMinutes) {
  const work = Math.max(0, normalizeMinute(workMinutes) ?? 0);
  if (work > 480) return 60;
  if (work > 360) return 45;
  return 0;
}

export function plannedBreakTemplates(spanMinutes) {
  const span = Math.max(0, normalizeMinute(spanMinutes) ?? 0);

  if (span <= 240) return [];

  // 店舗ルールとして、4時間超〜5時間までは任意の15分休憩を入れる。
  if (span <= 300) {
    return [{ type: "small", label: "小休憩", duration: 15, targetOffset: 120 }];
  }

  // 5時間を超えたら食事がとれるよう昼休憩45分を配置する。
  // 8時間45分までは、45分を差し引いた実働が8時間以下に収まる。
  if (span <= 525) {
    return [{
      type: "lunch",
      label: "昼休憩",
      duration: 45,
      targetOffset: Math.max(60, Math.round((span - 45) / 2))
    }];
  }

  // 8時間46分〜8時間59分は60分を配置する。
  if (span < 540) {
    return [{
      type: "lunch",
      label: "昼休憩",
      duration: 60,
      targetOffset: Math.max(60, Math.round((span - 60) / 2))
    }];
  }

  // 通常の長時間シフトは店舗ルールを維持し、15分+60分+15分を配置する。
  return [
    { type: "small", label: "小休憩", duration: 15, targetOffset: 120 },
    { type: "lunch", label: "昼休憩", duration: 60, targetOffset: Math.max(180, Math.round((span - 60) / 2)) },
    { type: "small", label: "小休憩", duration: 15, targetOffset: Math.max(300, span - 105) }
  ];
}

export function plannedBreakMinutes(spanMinutes) {
  return plannedBreakTemplates(spanMinutes).reduce((sum, item) => sum + item.duration, 0);
}

export function validateBreakTotals(spanMinutes, actualBreakMinutes) {
  const span = Math.max(0, normalizeMinute(spanMinutes) ?? 0);
  const actual = Math.max(0, normalizeMinute(actualBreakMinutes) ?? 0);
  const work = Math.max(0, span - actual);
  const required = requiredBreakMinutes(work);
  return {
    ok: actual >= required,
    span,
    work,
    required,
    actual,
    shortage: Math.max(0, required - actual)
  };
}

export function validateBreaks(shiftType, breaks = []) {
  if (!shiftType?.isWork) {
    return { ok: true, span: 0, work: 0, required: 0, actual: 0, shortage: 0, issues: [] };
  }

  const shiftStart = timeToMinutes(shiftType.start);
  const shiftEnd = timeToMinutes(shiftType.end);
  if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart || shiftEnd > MINUTES_PER_DAY) {
    return {
      ok: false,
      span: 0,
      work: 0,
      required: 0,
      actual: 0,
      shortage: 0,
      issues: ["シフトの開始・終了時刻が不正です。"]
    };
  }

  const issues = [];
  const intervals = [];
  for (const breakItem of Array.isArray(breaks) ? breaks : []) {
    const start = timeToMinutes(breakItem?.start);
    const end = timeToMinutes(breakItem?.end);
    if (start === null || end === null || end <= start) {
      issues.push("開始・終了時刻が不正な休憩があります。");
      continue;
    }
    if (start <= shiftStart || end >= shiftEnd) {
      issues.push("休憩は勤務時間の途中に配置してください。");
    }
    const clippedStart = Math.max(start, shiftStart);
    const clippedEnd = Math.min(end, shiftEnd);
    if (clippedEnd > clippedStart) intervals.push({ start: clippedStart, end: clippedEnd });
  }

  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start < sorted[index - 1].end) {
      issues.push("休憩時間が重複しています。");
      break;
    }
  }

  const totals = validateBreakTotals(shiftEnd - shiftStart, mergedIntervalMinutes(intervals));
  if (!totals.ok) issues.push(`休憩が${totals.shortage}分不足しています。`);

  return {
    ...totals,
    ok: totals.ok && issues.length === 0,
    issues: [...new Set(issues)]
  };
}
