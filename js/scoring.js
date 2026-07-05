import { requiredBreakMinutes } from "./break-rules.js";

export const SCORE_SLOT_MINUTES = 15;
export const SCORE_SLOT_COUNT = 96;

const DEFAULT_WEIGHTS = Object.freeze({
  understaffing: 1000,
  concurrentBreaks: 80,
  targetDeviation: 1
});

function minute(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function slots(start, end) {
  const first = Math.max(0, Math.floor(start / SCORE_SLOT_MINUTES));
  const last = Math.min(SCORE_SLOT_COUNT, Math.ceil(end / SCORE_SLOT_MINUTES));
  return Array.from({ length: Math.max(0, last - first) }, (_, index) => first + index);
}

function requiredAt(requiredCoverage, slot) {
  if (Array.isArray(requiredCoverage)) return Math.max(0, Number(requiredCoverage[slot]) || 0);
  const slotMinute = slot * SCORE_SLOT_MINUTES;
  return Math.max(0, Number(requiredCoverage?.[slotMinute] ?? requiredCoverage?.[String(slotMinute)]) || 0);
}

export function checkHard(dayPlan, config = {}) {
  const edge = Math.max(0, Number(config.edgeBufferMinutes ?? 60) || 0);
  const minimumGap = Math.max(0, Number(config.minimumBreakGapMinutes ?? 60) || 0);
  const issues = [];

  for (const employee of dayPlan?.employees ?? []) {
    const shiftStart = minute(employee.shiftStart);
    const shiftEnd = minute(employee.shiftEnd);
    const label = employee.name || employee.id || "employee";
    if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart) {
      issues.push(`${label}: invalid shift`);
      continue;
    }

    const breaks = [];
    for (const item of employee.breaks ?? []) {
      const start = minute(item.start);
      const end = minute(item.end);
      if (start === null || end === null || end <= start) {
        issues.push(`${label}: invalid break`);
        continue;
      }
      if (start < shiftStart + edge || end > shiftEnd - edge) issues.push(`${label}: break at shift edge`);
      breaks.push({ start, end });
    }

    breaks.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let index = 1; index < breaks.length; index += 1) {
      const gap = breaks[index].start - breaks[index - 1].end;
      if (gap < 0) issues.push(`${label}: overlapping breaks`);
      else if (gap < minimumGap) issues.push(`${label}: break gap too short`);
    }

    const totalBreak = breaks.reduce((sum, item) => sum + item.end - item.start, 0);
    const workMinutes = Math.max(0, shiftEnd - shiftStart - totalBreak);
    if (totalBreak < requiredBreakMinutes(workMinutes)) issues.push(`${label}: legal break shortage`);
  }

  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

export function score(dayPlan, config = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(config.weights ?? {}) };
  const active = Array(SCORE_SLOT_COUNT).fill(0);
  const breakLoad = Array(SCORE_SLOT_COUNT).fill(0);
  let targetDeviation = 0;

  for (const employee of dayPlan?.employees ?? []) {
    const shiftStart = minute(employee.shiftStart);
    const shiftEnd = minute(employee.shiftEnd);
    if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart) continue;
    for (const slot of slots(shiftStart, shiftEnd)) active[slot] += 1;

    for (const item of employee.breaks ?? []) {
      const start = minute(item.start);
      const end = minute(item.end);
      if (start === null || end === null || end <= start) continue;
      for (const slot of slots(start, end)) breakLoad[slot] += 1;
      const target = minute(item.target);
      if (target !== null) targetDeviation += Math.abs(start - target);
    }
  }

  let understaffing = 0;
  let concurrentBreaks = 0;
  for (let slot = 0; slot < SCORE_SLOT_COUNT; slot += 1) {
    const shortage = Math.max(0, requiredAt(config.requiredCoverage, slot) - (active[slot] - breakLoad[slot]));
    understaffing += shortage * shortage;
    const overlap = Math.max(0, breakLoad[slot] - 1);
    concurrentBreaks += overlap * overlap;
  }

  const weighted = {
    understaffing: understaffing * weights.understaffing,
    concurrentBreaks: concurrentBreaks * weights.concurrentBreaks,
    targetDeviation: targetDeviation * weights.targetDeviation
  };
  return {
    total: weighted.understaffing + weighted.concurrentBreaks + weighted.targetDeviation,
    breakdown: { understaffing, concurrentBreaks, targetDeviation, weighted }
  };
}
