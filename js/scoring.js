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

function targetDeviationOf(items) {
  let total = 0;
  for (const item of items ?? []) {
    const start = minute(item.start);
    const target = minute(item.target);
    if (start !== null && target !== null) total += Math.abs(start - target);
  }
  return total;
}

function rawSlotMetrics(active, breakLoad, requiredCoverage, slot) {
  const shortage = Math.max(0, requiredAt(requiredCoverage, slot) - (active[slot] - breakLoad[slot]));
  const overlap = Math.max(0, breakLoad[slot] - 1);
  return {
    understaffing: shortage * shortage,
    concurrentBreaks: overlap * overlap
  };
}

function weightedResult(raw, weights) {
  const weighted = {
    understaffing: raw.understaffing * weights.understaffing,
    concurrentBreaks: raw.concurrentBreaks * weights.concurrentBreaks,
    targetDeviation: raw.targetDeviation * weights.targetDeviation
  };
  return {
    total: weighted.understaffing + weighted.concurrentBreaks + weighted.targetDeviation,
    breakdown: { ...raw, weighted }
  };
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

export function createScoreContext(dayPlan, config = {}) {
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
    }
    targetDeviation += targetDeviationOf(employee.breaks);
  }

  let understaffing = 0;
  let concurrentBreaks = 0;
  for (let slot = 0; slot < SCORE_SLOT_COUNT; slot += 1) {
    const metrics = rawSlotMetrics(active, breakLoad, config.requiredCoverage, slot);
    understaffing += metrics.understaffing;
    concurrentBreaks += metrics.concurrentBreaks;
  }

  const raw = { understaffing, concurrentBreaks, targetDeviation };
  return {
    active,
    breakLoad,
    requiredCoverage: config.requiredCoverage,
    weights,
    raw,
    result: weightedResult(raw, weights)
  };
}

export function evaluateBreakReplacement(context, previousItems, nextItems) {
  const deltas = new Map();
  for (const item of previousItems ?? []) {
    const start = minute(item.start);
    const end = minute(item.end);
    if (start === null || end === null) continue;
    for (const slot of slots(start, end)) deltas.set(slot, (deltas.get(slot) ?? 0) - 1);
  }
  for (const item of nextItems ?? []) {
    const start = minute(item.start);
    const end = minute(item.end);
    if (start === null || end === null) continue;
    for (const slot of slots(start, end)) deltas.set(slot, (deltas.get(slot) ?? 0) + 1);
  }

  const raw = { ...context.raw };
  const slotChanges = [];
  for (const [slot, delta] of deltas) {
    if (delta === 0) continue;
    const before = rawSlotMetrics(context.active, context.breakLoad, context.requiredCoverage, slot);
    const nextLoad = context.breakLoad[slot] + delta;
    const after = rawSlotMetrics(context.active, { ...context.breakLoad, [slot]: nextLoad }, context.requiredCoverage, slot);
    raw.understaffing += after.understaffing - before.understaffing;
    raw.concurrentBreaks += after.concurrentBreaks - before.concurrentBreaks;
    slotChanges.push([slot, nextLoad]);
  }
  raw.targetDeviation += targetDeviationOf(nextItems) - targetDeviationOf(previousItems);
  return { ...weightedResult(raw, context.weights), raw, slotChanges };
}

export function applyBreakReplacement(context, evaluation) {
  for (const [slot, value] of evaluation.slotChanges) context.breakLoad[slot] = value;
  context.raw = { ...evaluation.raw };
  context.result = { total: evaluation.total, breakdown: evaluation.breakdown };
  return context;
}

export function score(dayPlan, config = {}) {
  return createScoreContext(dayPlan, config).result;
}
