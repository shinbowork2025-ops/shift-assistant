import { minutesToTime, timeToMinutes } from "./date-time.js";
import { plannedBreakTemplates } from "./break-rules.js";
import {
  checkHard,
  score,
  buildActiveWorkerCounts,
  buildBreakLoadCounts,
  BREAK_SCORE_CONFIG
} from "./scoring.js";
import { shuffleWithSeed } from "./rng.js";

const DEFAULT_OPTIMIZER_CONFIG = Object.freeze({
  ...BREAK_SCORE_CONFIG,
  restarts: 3,
  maxPasses: 20,
  seed: "breaks-v1"
});

function configWithDefaults(config = {}) {
  return {
    ...DEFAULT_OPTIMIZER_CONFIG,
    ...config,
    weights: { ...DEFAULT_OPTIMIZER_CONFIG.weights, ...(config.weights ?? {}) }
  };
}

function slotStartRange(earliest, latest, slotMinutes) {
  const starts = [];
  const first = Math.ceil(earliest / slotMinutes) * slotMinutes;
  const last = Math.floor(latest / slotMinutes) * slotMinutes;
  for (let minute = first; minute <= last; minute += slotMinutes) starts.push(minute);
  return starts;
}

function breakDuration(breakItem) {
  const start = timeToMinutes(breakItem?.start);
  const end = timeToMinutes(breakItem?.end);
  return start !== null && end !== null && end > start ? end - start : 0;
}

function normalizeAssignments(assignments) {
  return assignments.map((assignment) => ({
    ...assignment,
    templates: plannedBreakTemplates(shiftSpan(assignment.shiftType))
  }));
}

function shiftSpan(shiftType) {
  const start = timeToMinutes(shiftType?.start);
  const end = timeToMinutes(shiftType?.end);
  return start !== null && end !== null && end > start ? end - start : 0;
}

function targetEmployeeSet(assignments, targetEmployeeIds) {
  return targetEmployeeIds
    ? new Set(targetEmployeeIds)
    : new Set(assignments.map(({ employee }) => employee.id));
}

function sortedBreaks(breaks = []) {
  return [...(Array.isArray(breaks) ? breaks : [])].sort((a, b) => {
    const startDifference = (timeToMinutes(a?.start) ?? 0) - (timeToMinutes(b?.start) ?? 0);
    return startDifference || (timeToMinutes(a?.end) ?? 0) - (timeToMinutes(b?.end) ?? 0);
  });
}

function decorateBreak(template, start, locked = false) {
  return {
    type: template.type,
    label: template.label,
    start: minutesToTime(start),
    end: minutesToTime(start + template.duration),
    ...(locked ? { locked: true } : {})
  };
}

function addBreaksToLoad(load, breaks = [], config) {
  const next = new Map(load);
  for (const breakItem of breaks ?? []) {
    const start = timeToMinutes(breakItem?.start);
    const end = timeToMinutes(breakItem?.end);
    if (start === null || end === null || end <= start) continue;
    for (let minute = Math.floor(start / config.slotMinutes) * config.slotMinutes; minute < end; minute += config.slotMinutes) {
      next.set(minute, (next.get(minute) ?? 0) + 1);
    }
  }
  return next;
}

function loadWithoutEmployee(breaksByEmployee, employeeId, config) {
  const baseBreaks = { ...(breaksByEmployee ?? {}) };
  delete baseBreaks[employeeId];
  return buildBreakLoadCounts(baseBreaks, config);
}

function isCompatibleWithPlaced(candidate, placed, config) {
  const start = timeToMinutes(candidate.start);
  const end = timeToMinutes(candidate.end);
  if (start === null || end === null || end <= start) return false;
  for (const breakItem of placed) {
    const otherStart = timeToMinutes(breakItem.start);
    const otherEnd = timeToMinutes(breakItem.end);
    if (otherStart === null || otherEnd === null) continue;
    if (start < otherEnd && end > otherStart) return false;
    const gap = start >= otherEnd ? start - otherEnd : otherStart - end;
    if (gap < config.minBreakGapMinutes) return false;
  }
  return true;
}

function lockedBreakByTemplateIndex(existingBreaks = [], templates = []) {
  const sorted = sortedBreaks(existingBreaks);
  const locked = new Map();
  templates.forEach((template, index) => {
    const breakItem = sorted[index];
    if (breakItem?.locked && breakDuration(breakItem) === template.duration) {
      locked.set(index, { ...breakItem, type: breakItem.type ?? template.type, label: breakItem.label ?? template.label });
    }
  });
  return locked;
}

export function enumerateBreakPatterns(assignment, existingBreaks = [], config = {}) {
  const mergedConfig = configWithDefaults(config);
  const templates = plannedBreakTemplates(shiftSpan(assignment.shiftType));
  const shiftStart = timeToMinutes(assignment.shiftType?.start);
  const shiftEnd = timeToMinutes(assignment.shiftType?.end);
  if (!templates.length) return [[]];
  if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart) return [];

  const lockedByIndex = lockedBreakByTemplateIndex(existingBreaks, templates);
  const patterns = [];

  function visit(index, placed) {
    if (index >= templates.length) {
      const candidate = [...placed];
      if (checkHard([{ ...assignment, templates }], { [assignment.employee.id]: candidate }, mergedConfig).ok) {
        patterns.push(candidate);
      }
      return;
    }

    const template = templates[index];
    const locked = lockedByIndex.get(index);
    if (locked) {
      if (isCompatibleWithPlaced(locked, placed, mergedConfig)) visit(index + 1, [...placed, locked]);
      return;
    }

    const earliest = shiftStart + mergedConfig.edgeBufferMinutes;
    const latest = shiftEnd - mergedConfig.edgeBufferMinutes - template.duration;
    for (const start of slotStartRange(earliest, latest, mergedConfig.slotMinutes)) {
      const candidate = decorateBreak(template, start);
      if (isCompatibleWithPlaced(candidate, placed, mergedConfig)) visit(index + 1, [...placed, candidate]);
    }
  }

  visit(0, []);
  return patterns;
}

export function buildGreedyBreaks(assignments, existingBreaksByEmployee = {}, targetEmployeeIds = null, config = {}) {
  const mergedConfig = configWithDefaults(config);
  const normalized = normalizeAssignments(assignments);
  const activeCounts = buildActiveWorkerCounts(normalized, mergedConfig);
  const targets = targetEmployeeSet(normalized, targetEmployeeIds);
  const result = structuredClone(existingBreaksByEmployee ?? {});

  for (const employeeId of targets) delete result[employeeId];

  for (const assignment of normalized) {
    if (!targets.has(assignment.employee.id)) continue;
    const patterns = enumerateBreakPatterns(assignment, existingBreaksByEmployee?.[assignment.employee.id] ?? [], mergedConfig);
    const baseLoad = loadWithoutEmployee(result, assignment.employee.id, mergedConfig);
    let best = patterns[0] ?? [];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const pattern of patterns) {
      const candidateBreaks = { ...result, [assignment.employee.id]: pattern };
      const breakLoadCounts = addBreaksToLoad(baseLoad, pattern, mergedConfig);
      const candidateScore = score(normalized, candidateBreaks, { ...mergedConfig, activeCounts, breakLoadCounts }).total;
      if (candidateScore < bestScore) {
        best = pattern;
        bestScore = candidateScore;
      }
    }
    result[assignment.employee.id] = best;
  }

  return result;
}

export function optimizeBreaks(dayPlan, config = {}) {
  const mergedConfig = configWithDefaults({ ...(dayPlan?.config ?? {}), ...config });
  const assignments = normalizeAssignments(dayPlan?.assignments ?? []);
  const activeCounts = buildActiveWorkerCounts(assignments, mergedConfig);
  const targets = [...targetEmployeeSet(assignments, dayPlan?.targetEmployeeIds)];
  const initialBreaks = structuredClone(dayPlan?.initialBreaks ?? buildGreedyBreaks(assignments, dayPlan?.existingBreaks ?? {}, targets, mergedConfig));
  const initialScore = score(assignments, initialBreaks, { ...mergedConfig, activeCounts });
  const patternsByEmployee = new Map(assignments.map((assignment) => [
    assignment.employee.id,
    enumerateBreakPatterns(assignment, dayPlan?.existingBreaks?.[assignment.employee.id] ?? initialBreaks[assignment.employee.id] ?? [], mergedConfig)
  ]));
  let bestBreaks = structuredClone(initialBreaks);
  let bestScore = initialScore;
  let iterations = 0;

  for (let restart = 0; restart < mergedConfig.restarts; restart += 1) {
    let currentBreaks = structuredClone(initialBreaks);
    let currentScore = initialScore;

    for (let pass = 0; pass < mergedConfig.maxPasses; pass += 1) {
      let improved = false;
      const order = shuffleWithSeed(targets, `${mergedConfig.seed}:${restart}:${pass}`);

      for (const employeeId of order) {
        const assignment = assignments.find((item) => item.employee.id === employeeId);
        if (!assignment) continue;
        const patterns = patternsByEmployee.get(employeeId) ?? [];
        const baseLoad = loadWithoutEmployee(currentBreaks, employeeId, mergedConfig);
        let employeeBestBreaks = currentBreaks;
        let employeeBestScore = currentScore;

        for (const pattern of patterns) {
          iterations += 1;
          const candidateBreaks = { ...currentBreaks, [employeeId]: pattern };
          const breakLoadCounts = addBreaksToLoad(baseLoad, pattern, mergedConfig);
          const candidateScore = score(assignments, candidateBreaks, { ...mergedConfig, activeCounts, breakLoadCounts });
          if (candidateScore.total < employeeBestScore.total) {
            employeeBestBreaks = candidateBreaks;
            employeeBestScore = candidateScore;
          }
        }

        if (employeeBestScore.total < currentScore.total) {
          currentBreaks = employeeBestBreaks;
          currentScore = employeeBestScore;
          improved = true;
        }
      }

      if (!improved) break;
    }

    if (currentScore.total < bestScore.total) {
      bestBreaks = structuredClone(currentBreaks);
      bestScore = currentScore;
    }
  }

  return {
    breaks: bestBreaks,
    score: bestScore.total,
    breakdown: bestScore.breakdown,
    initialScore: initialScore.total,
    initialBreaks,
    iterations
  };
}
