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

function slotContribution(activeCount, load, weights) {
  if (!load) return {
    unavailableSlots: 0,
    lowCoverage: 0,
    concurrentBreaks: 0
  };
  const available = activeCount - load;
  return {
    unavailableSlots: available <= 0 ? 1 : 0,
    lowCoverage: load * load,
    concurrentBreaks: load * load
  };
}

function addContribution(target, contribution, direction = 1) {
  target.unavailableSlots += contribution.unavailableSlots * direction;
  target.lowCoverage += contribution.lowCoverage * direction;
  target.concurrentBreaks += contribution.concurrentBreaks * direction;
}

function patternSlotCounts(breaks = [], config) {
  const counts = new Map();
  for (const breakItem of breaks ?? []) {
    const start = timeToMinutes(breakItem?.start);
    const end = timeToMinutes(breakItem?.end);
    if (start === null || end === null || end <= start) continue;
    for (let minute = Math.floor(start / config.slotMinutes) * config.slotMinutes; minute < end; minute += config.slotMinutes) {
      counts.set(minute, (counts.get(minute) ?? 0) + 1);
    }
  }
  return counts;
}

function breakLoadBreakdown(activeCounts, breakLoad, config) {
  const breakdown = {
    unavailableSlots: 0,
    lowCoverage: 0,
    concurrentBreaks: 0,
    targetDeviation: 0
  };
  for (const [slot, activeCount] of activeCounts) {
    addContribution(breakdown, slotContribution(activeCount, breakLoad.get(slot) ?? 0, config.weights));
  }
  return breakdown;
}

function targetDeviationFor(assignment, breaks = []) {
  const shiftStart = timeToMinutes(assignment.shiftType?.start);
  if (shiftStart === null) return 0;
  return assignment.templates.reduce((sum, template, index) => {
    const start = timeToMinutes(breaks[index]?.start);
    return start === null ? sum : sum + Math.abs(start - (shiftStart + template.targetOffset));
  }, 0);
}

function totalTargetDeviation(assignments, breaksByEmployee = {}) {
  return assignments.reduce((sum, assignment) => (
    sum + targetDeviationFor(assignment, breaksByEmployee[assignment.employee.id] ?? [])
  ), 0);
}

function totalFromBreakdown(breakdown, config) {
  return (
    breakdown.unavailableSlots * config.weights.unavailableSlot
    + breakdown.lowCoverage * config.weights.lowCoverage
    + breakdown.concurrentBreaks * config.weights.concurrentBreak
    + breakdown.targetDeviation * config.weights.targetDeviation
  );
}

function scoreFromBreakdown(breakdown, config) {
  return { total: totalFromBreakdown(breakdown, config), breakdown };
}

function candidateScoreWithPattern({ activeCounts, baseLoad, baseBreakdown, baseTargetDeviation, assignment, pattern, config }) {
  const breakdown = { ...baseBreakdown, targetDeviation: baseTargetDeviation + targetDeviationFor(assignment, pattern) };
  for (const [slot, count] of patternSlotCounts(pattern, config)) {
    const activeCount = activeCounts.get(slot) ?? 0;
    const oldLoad = baseLoad.get(slot) ?? 0;
    const nextLoad = oldLoad + count;
    addContribution(breakdown, slotContribution(activeCount, oldLoad, config.weights), -1);
    addContribution(breakdown, slotContribution(activeCount, nextLoad, config.weights));
  }
  return scoreFromBreakdown(breakdown, config);
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
    const previousEnd = placed.length
      ? timeToMinutes(placed[placed.length - 1].end)
      : shiftStart;
    const remainingTemplates = templates.slice(index + 1);
    const remainingMinutes = remainingTemplates.reduce((sum, item) => (
      sum + item.duration + mergedConfig.minBreakGapMinutes
    ), 0);
    const locked = lockedByIndex.get(index);
    if (locked) {
      const lockedStart = timeToMinutes(locked.start);
      const lockedEnd = timeToMinutes(locked.end);
      if (
        lockedStart !== null
        && lockedEnd !== null
        && previousEnd !== null
        && lockedStart >= previousEnd + (placed.length ? mergedConfig.minBreakGapMinutes : 0)
        && lockedEnd <= shiftEnd - mergedConfig.edgeBufferMinutes - remainingMinutes
        && isCompatibleWithPlaced(locked, placed, mergedConfig)
      ) {
        visit(index + 1, [...placed, locked]);
      }
      return;
    }

    const earliest = Math.max(
      shiftStart + mergedConfig.edgeBufferMinutes,
      previousEnd + (placed.length ? mergedConfig.minBreakGapMinutes : 0)
    );
    const latest = shiftEnd - mergedConfig.edgeBufferMinutes - template.duration - remainingMinutes;
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
    const baseBreakdown = breakLoadBreakdown(activeCounts, baseLoad, mergedConfig);
    const baseTargetDeviation = totalTargetDeviation(normalized, result) - targetDeviationFor(assignment, result[assignment.employee.id] ?? []);
    let best = patterns[0] ?? [];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const pattern of patterns) {
      const candidateScore = candidateScoreWithPattern({
        activeCounts,
        baseLoad,
        baseBreakdown,
        baseTargetDeviation,
        assignment,
        pattern,
        config: mergedConfig
      }).total;
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
        const baseBreakdown = breakLoadBreakdown(activeCounts, baseLoad, mergedConfig);
        const baseTargetDeviation = totalTargetDeviation(assignments, currentBreaks) - targetDeviationFor(assignment, currentBreaks[employeeId] ?? []);
        let employeeBestBreaks = currentBreaks;
        let employeeBestScore = currentScore;
        let employeeBestPattern = currentBreaks[employeeId] ?? [];

        for (const pattern of patterns) {
          iterations += 1;
          const candidateScore = candidateScoreWithPattern({
            activeCounts,
            baseLoad,
            baseBreakdown,
            baseTargetDeviation,
            assignment,
            pattern,
            config: mergedConfig
          });
          if (candidateScore.total < employeeBestScore.total) {
            employeeBestPattern = pattern;
            employeeBestScore = candidateScore;
          }
        }

        if (employeeBestScore.total < currentScore.total) {
          employeeBestBreaks = { ...currentBreaks, [employeeId]: employeeBestPattern };
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
