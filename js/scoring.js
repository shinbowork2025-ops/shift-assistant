import { timeToMinutes } from "./date-time.js";
import { validateBreaks } from "./break-rules.js";

export const BREAK_SCORE_WEIGHTS = Object.freeze({
  unavailableSlot: 100000,
  lowCoverage: 1200,
  concurrentBreak: 80,
  targetDeviation: 1
});

export const BREAK_SCORE_CONFIG = Object.freeze({
  slotMinutes: 15,
  edgeBufferMinutes: 60,
  minBreakGapMinutes: 60,
  weights: BREAK_SCORE_WEIGHTS
});

function slotRange(start, duration, slotMinutes) {
  const end = start + duration;
  const slots = [];
  for (let minute = Math.floor(start / slotMinutes) * slotMinutes; minute < end; minute += slotMinutes) {
    slots.push(minute);
  }
  return slots;
}

function sortedBreaks(breaks = []) {
  return [...(Array.isArray(breaks) ? breaks : [])].sort((a, b) => {
    const startDifference = (timeToMinutes(a?.start) ?? 0) - (timeToMinutes(b?.start) ?? 0);
    return startDifference || (timeToMinutes(a?.end) ?? 0) - (timeToMinutes(b?.end) ?? 0);
  });
}

export function buildActiveWorkerCounts(assignments, config = {}) {
  const slotMinutes = config.slotMinutes ?? BREAK_SCORE_CONFIG.slotMinutes;
  const active = new Map();
  for (const { shiftType } of assignments) {
    const start = timeToMinutes(shiftType?.start);
    const end = timeToMinutes(shiftType?.end);
    if (start === null || end === null || end <= start) continue;
    for (const slot of slotRange(start, end - start, slotMinutes)) {
      active.set(slot, (active.get(slot) ?? 0) + 1);
    }
  }
  return active;
}

export function buildBreakLoadCounts(breaksByEmployee = {}, config = {}) {
  const slotMinutes = config.slotMinutes ?? BREAK_SCORE_CONFIG.slotMinutes;
  const load = new Map();
  for (const breaks of Object.values(breaksByEmployee ?? {})) {
    for (const breakItem of breaks ?? []) {
      const start = timeToMinutes(breakItem?.start);
      const end = timeToMinutes(breakItem?.end);
      if (start === null || end === null || end <= start) continue;
      for (const slot of slotRange(start, end - start, slotMinutes)) {
        load.set(slot, (load.get(slot) ?? 0) + 1);
      }
    }
  }
  return load;
}

export function checkHard(assignments, breaksByEmployee = {}, config = {}) {
  const edgeBufferMinutes = config.edgeBufferMinutes ?? BREAK_SCORE_CONFIG.edgeBufferMinutes;
  const minBreakGapMinutes = config.minBreakGapMinutes ?? BREAK_SCORE_CONFIG.minBreakGapMinutes;
  const issues = [];

  for (const { employee, shiftType } of assignments) {
    if (!shiftType?.isWork) continue;
    const employeeId = employee?.id;
    const breaks = sortedBreaks(breaksByEmployee?.[employeeId] ?? []);
    const validation = validateBreaks(shiftType, breaks);
    if (!validation.ok) {
      issues.push({ employeeId, messages: validation.issues });
      continue;
    }

    const shiftStart = timeToMinutes(shiftType.start);
    const shiftEnd = timeToMinutes(shiftType.end);
    for (let index = 0; index < breaks.length; index += 1) {
      const breakItem = breaks[index];
      const start = timeToMinutes(breakItem.start);
      const end = timeToMinutes(breakItem.end);
      if (start === null || end === null) continue;
      if (start < shiftStart + edgeBufferMinutes || end > shiftEnd - edgeBufferMinutes) {
        issues.push({ employeeId, messages: ["休憩は始業後・終業前の余裕時間内に配置してください。"] });
      }
      if (index > 0) {
        const previousEnd = timeToMinutes(breaks[index - 1].end);
        if (previousEnd !== null && start - previousEnd < minBreakGapMinutes) {
          issues.push({ employeeId, messages: ["休憩同士の間隔が不足しています。"] });
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

export function score(assignments, breaksByEmployee = {}, config = {}) {
  const weights = { ...BREAK_SCORE_WEIGHTS, ...(config.weights ?? {}) };
  const active = config.activeCounts ?? buildActiveWorkerCounts(assignments, config);
  const breakLoad = config.breakLoadCounts ?? buildBreakLoadCounts(breaksByEmployee, config);
  const breakdown = {
    unavailableSlots: 0,
    lowCoverage: 0,
    concurrentBreaks: 0,
    targetDeviation: 0
  };

  for (const [slot, activeCount] of active) {
    const load = breakLoad.get(slot) ?? 0;
    if (load === 0) continue;
    const available = activeCount - load;
    if (available <= 0) breakdown.unavailableSlots += 1;
    breakdown.lowCoverage += Math.max(0, activeCount - available) * Math.max(0, activeCount - available);
    breakdown.concurrentBreaks += load * load;
  }

  for (const { employee, shiftType, templates = [] } of assignments) {
    const breaks = breaksByEmployee?.[employee?.id] ?? [];
    const shiftStart = timeToMinutes(shiftType?.start);
    templates.forEach((template, index) => {
      const start = timeToMinutes(breaks[index]?.start);
      if (start !== null && shiftStart !== null) breakdown.targetDeviation += Math.abs(start - (shiftStart + template.targetOffset));
    });
  }

  const total = (
    breakdown.unavailableSlots * weights.unavailableSlot
    + breakdown.lowCoverage * weights.lowCoverage
    + breakdown.concurrentBreaks * weights.concurrentBreak
    + breakdown.targetDeviation * weights.targetDeviation
  );

  return { total, breakdown };
}
