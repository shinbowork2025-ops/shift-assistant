import { minutesToTime } from "./date-time.js";
import { validateBreaks } from "./break-rules.js";

const SLOT_MINUTES = 15;

export const DEFAULT_SCORING_CONFIG = Object.freeze({
  slotMinutes: SLOT_MINUTES,
  edgeBufferMinutes: 60,
  minGapMinutes: 60,
  noStaffPenalty: 5000,
  lowStaffPenalty: 1400,
  overlapPenalty: 20000,
  edgePenalty: 20000,
  gapPenalty: 12000,
  shortagePenalty: 30000,
  concurrencyWeight: 80,
  timingWeight: 1
});

function slotRange(start, duration, slotMinutes) {
  const end = start + duration;
  const slots = [];
  for (let minute = Math.floor(start / slotMinutes) * slotMinutes; minute < end; minute += slotMinutes) {
    slots.push(minute);
  }
  return slots;
}

function normalizedBreaks(breaks = []) {
  return [...breaks]
    .map((breakItem) => {
      const startMinute = Number(breakItem?.startMinute);
      const endMinute = Number(breakItem?.endMinute);
      if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) return null;
      return {
        type: breakItem.type,
        label: breakItem.label,
        locked: breakItem.locked === true,
        startMinute,
        endMinute
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

function employeeShiftBounds(employees) {
  let start = Infinity;
  let end = -Infinity;
  for (const employee of employees) {
    start = Math.min(start, employee.shiftStartMinute);
    end = Math.max(end, employee.shiftEndMinute);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { start: 8 * 60, end: 22 * 60 };
  return { start, end };
}

function activeWorkersBySlot(dayPlan, config) {
  const active = new Map();
  for (const employee of dayPlan.employees) {
    const duration = employee.shiftEndMinute - employee.shiftStartMinute;
    for (const slot of slotRange(employee.shiftStartMinute, duration, config.slotMinutes)) {
      active.set(slot, (active.get(slot) ?? 0) + 1);
    }
  }
  return active;
}

function breakLoadBySlot(dayPlan, breaksByEmployee, config) {
  const breakLoad = new Map();
  for (const employee of dayPlan.employees) {
    const breaks = normalizedBreaks(breaksByEmployee[employee.id]);
    for (const breakItem of breaks) {
      const duration = breakItem.endMinute - breakItem.startMinute;
      for (const slot of slotRange(breakItem.startMinute, duration, config.slotMinutes)) {
        breakLoad.set(slot, (breakLoad.get(slot) ?? 0) + 1);
      }
    }
  }
  return breakLoad;
}

function clampScore(value) {
  return Math.round(Number(value) || 0);
}

function canonicalBreakEntry(breakItem) {
  return `${breakItem.type ?? ""}:${breakItem.startMinute}-${breakItem.endMinute}:${breakItem.locked ? "1" : "0"}`;
}

export function canonicalBreaks(breaksByEmployee = {}) {
  const employeeIds = Object.keys(breaksByEmployee).sort();
  return employeeIds
    .map((employeeId) => {
      const entries = normalizedBreaks(breaksByEmployee[employeeId]).map(canonicalBreakEntry).join("|");
      return `${employeeId}=${entries}`;
    })
    .join(";");
}

export function checkHard(dayPlan, breaksByEmployee = {}, config = {}) {
  const mergedConfig = { ...DEFAULT_SCORING_CONFIG, ...config };
  const issues = [];
  for (const employee of dayPlan.employees) {
    const breaks = normalizedBreaks(breaksByEmployee[employee.id]);
    for (let index = 0; index < breaks.length; index += 1) {
      const breakItem = breaks[index];
      const fromStart = breakItem.startMinute - employee.shiftStartMinute;
      const toEnd = employee.shiftEndMinute - breakItem.endMinute;
      if (fromStart < mergedConfig.edgeBufferMinutes || toEnd < mergedConfig.edgeBufferMinutes) {
        issues.push(`${employee.id}: 休憩が勤務の端に近すぎます`);
      }
      if (index > 0) {
        const gap = breakItem.startMinute - breaks[index - 1].endMinute;
        if (gap < mergedConfig.minGapMinutes) issues.push(`${employee.id}: 休憩間隔が不足しています`);
      }
    }
    const validation = validateBreaks(
      { isWork: true, start: minutesToTime(employee.shiftStartMinute), end: minutesToTime(employee.shiftEndMinute) },
      breaks.map((breakItem) => ({
        type: breakItem.type,
        label: breakItem.label,
        start: minutesToTime(breakItem.startMinute),
        end: minutesToTime(breakItem.endMinute)
      }))
    );
    if (!validation.ok) issues.push(`${employee.id}: ${validation.issues.join(" / ")}`);
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

export function score(dayPlan, breaksByEmployee = {}, config = {}) {
  const mergedConfig = { ...DEFAULT_SCORING_CONFIG, ...config };
  const activeBySlot = activeWorkersBySlot(dayPlan, mergedConfig);
  const breakLoadByTimeline = breakLoadBySlot(dayPlan, breaksByEmployee, mergedConfig);
  const bounds = employeeShiftBounds(dayPlan.employees);
  let availabilityPenalty = 0;
  let concurrencyPenalty = 0;

  for (let slot = Math.floor(bounds.start / mergedConfig.slotMinutes) * mergedConfig.slotMinutes;
    slot < bounds.end;
    slot += mergedConfig.slotMinutes) {
    const active = activeBySlot.get(slot) ?? 0;
    if (active <= 0) continue;
    const onBreak = breakLoadByTimeline.get(slot) ?? 0;
    const available = active - onBreak;
    if (available <= 0) availabilityPenalty += mergedConfig.noStaffPenalty * (1 - available);
    else if (available === 1) availabilityPenalty += mergedConfig.lowStaffPenalty;
    concurrencyPenalty += onBreak * onBreak * mergedConfig.concurrencyWeight;
  }

  let timingPenalty = 0;
  for (const employee of dayPlan.employees) {
    const breaks = normalizedBreaks(breaksByEmployee[employee.id]);
    for (let index = 0; index < employee.templates.length; index += 1) {
      const template = employee.templates[index];
      const breakItem = breaks[index];
      if (!breakItem) continue;
      const target = employee.shiftStartMinute + template.targetOffset;
      timingPenalty += Math.abs(breakItem.startMinute - target) * mergedConfig.timingWeight;
    }
  }

  let hardPenalty = 0;
  for (const employee of dayPlan.employees) {
    const breaks = normalizedBreaks(breaksByEmployee[employee.id]);
    for (let index = 0; index < breaks.length; index += 1) {
      const breakItem = breaks[index];
      if (breakItem.startMinute <= employee.shiftStartMinute + mergedConfig.edgeBufferMinutes) hardPenalty += mergedConfig.edgePenalty;
      if (breakItem.endMinute >= employee.shiftEndMinute - mergedConfig.edgeBufferMinutes) hardPenalty += mergedConfig.edgePenalty;
      if (index > 0) {
        const gap = breakItem.startMinute - breaks[index - 1].endMinute;
        if (gap < mergedConfig.minGapMinutes) hardPenalty += mergedConfig.gapPenalty;
        if (breakItem.startMinute < breaks[index - 1].endMinute) hardPenalty += mergedConfig.overlapPenalty;
      }
    }
    const validation = validateBreaks(
      { isWork: true, start: minutesToTime(employee.shiftStartMinute), end: minutesToTime(employee.shiftEndMinute) },
      breaks.map((breakItem) => ({
        type: breakItem.type,
        label: breakItem.label,
        start: minutesToTime(breakItem.startMinute),
        end: minutesToTime(breakItem.endMinute)
      }))
    );
    if (!validation.ok) hardPenalty += mergedConfig.shortagePenalty + (validation.shortage * 200);
  }

  const breakdown = {
    availabilityPenalty: clampScore(availabilityPenalty),
    concurrencyPenalty: clampScore(concurrencyPenalty),
    timingPenalty: clampScore(timingPenalty),
    hardPenalty: clampScore(hardPenalty)
  };
  return {
    score: breakdown.availabilityPenalty + breakdown.concurrencyPenalty + breakdown.timingPenalty + breakdown.hardPenalty,
    breakdown
  };
}
