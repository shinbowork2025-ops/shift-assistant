import { createMulberry32, shuffleWithRng } from "./rng.js";
import { score, checkHard, canonicalBreaks } from "./scoring.js";

export const DEFAULT_OPTIMIZER_CONFIG = Object.freeze({
  seed: 20260705,
  restarts: 3,
  maxSweeps: 6,
  slotMinutes: 15,
  edgeBufferMinutes: 60,
  minGapMinutes: 60,
  maxPatternsPerEmployee: 8
});

function normalizeBreaks(breaks = []) {
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

function cloneBreakMap(dayPlan, breaksByEmployee = {}) {
  const result = {};
  for (const employee of dayPlan.employees) {
    result[employee.id] = normalizeBreaks(breaksByEmployee[employee.id]);
  }
  return result;
}

function removeLockedTemplates(templates, lockedBreaks) {
  const remaining = [...templates];
  for (const lockedBreak of lockedBreaks) {
    const duration = lockedBreak.endMinute - lockedBreak.startMinute;
    const matchedIndex = remaining.findIndex((template) =>
      template.duration === duration && (!lockedBreak.type || template.type === lockedBreak.type)
    );
    if (matchedIndex >= 0) remaining.splice(matchedIndex, 1);
  }
  return remaining;
}

function slotRange(start, duration, slotMinutes) {
  const end = start + duration;
  const slots = [];
  for (let minute = Math.floor(start / slotMinutes) * slotMinutes; minute < end; minute += slotMinutes) {
    slots.push(minute);
  }
  return slots;
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

function addBreaksToLoad(breaks, breakLoad, config) {
  for (const breakItem of breaks) {
    for (const slot of slotRange(breakItem.startMinute, breakItem.endMinute - breakItem.startMinute, config.slotMinutes)) {
      breakLoad.set(slot, (breakLoad.get(slot) ?? 0) + 1);
    }
  }
}

function candidateStarts(target, earliest, latest, slotMinutes) {
  const starts = [];
  for (let offset = -60; offset <= 60; offset += slotMinutes) {
    const rounded = Math.round((target + offset) / slotMinutes) * slotMinutes;
    if (rounded < earliest || rounded > latest || starts.includes(rounded)) continue;
    starts.push(rounded);
  }
  if (starts.length === 0) {
    const fallback = Math.min(latest, Math.max(earliest, Math.round(target / slotMinutes) * slotMinutes));
    starts.push(fallback);
  }
  return starts;
}

function rangesHaveRequiredGap(left, right, minimumGapMinutes) {
  if (left.endMinute <= right.startMinute) return right.startMinute - left.endMinute >= minimumGapMinutes;
  if (right.endMinute <= left.startMinute) return left.startMinute - right.endMinute >= minimumGapMinutes;
  return false;
}

function isFeasibleBreak(employee, candidate, placedBreaks, config) {
  if (candidate.startMinute < employee.shiftStartMinute + config.edgeBufferMinutes) return false;
  if (candidate.endMinute > employee.shiftEndMinute - config.edgeBufferMinutes) return false;
  return placedBreaks.every((existingBreak) => rangesHaveRequiredGap(existingBreak, candidate, config.minGapMinutes));
}

function chooseGreedyStart({ employee, template, activeBySlot, breakLoad, placedBreaks, config }) {
  const target = employee.shiftStartMinute + template.targetOffset;
  const earliest = employee.shiftStartMinute + config.edgeBufferMinutes;
  const latest = employee.shiftEndMinute - config.edgeBufferMinutes - template.duration;
  if (latest < earliest) return null;
  const starts = candidateStarts(target, earliest, latest, config.slotMinutes);
  let bestStart = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const startMinute of starts) {
    const candidate = {
      type: template.type,
      label: template.label,
      startMinute,
      endMinute: startMinute + template.duration
    };
    if (!isFeasibleBreak(employee, candidate, placedBreaks, config)) continue;
    const slots = slotRange(candidate.startMinute, template.duration, config.slotMinutes);
    let minimumAvailable = Number.POSITIVE_INFINITY;
    let concurrentBreaks = 0;
    for (const slot of slots) {
      const active = activeBySlot.get(slot) ?? 0;
      const onBreak = breakLoad.get(slot) ?? 0;
      minimumAvailable = Math.min(minimumAvailable, active - onBreak - 1);
      concurrentBreaks += onBreak;
    }
    const deviation = Math.abs(startMinute - target);
    const localScore = (-minimumAvailable * 1000) + (concurrentBreaks * 100) + deviation;
    if (localScore < bestScore || (localScore === bestScore && startMinute < bestStart)) {
      bestScore = localScore;
      bestStart = startMinute;
    }
  }
  return bestStart;
}

export function createGreedyBreaks(dayPlan, options = {}) {
  const config = { ...DEFAULT_OPTIMIZER_CONFIG, ...options };
  const targetIds = new Set(options.targetEmployeeIds ?? dayPlan.employees.map((employee) => employee.id));
  const baseBreaks = cloneBreakMap(dayPlan, options.baseBreaksByEmployee);
  const breakLoad = new Map();
  const activeBySlot = activeWorkersBySlot(dayPlan, config);
  const employeesByStart = [...dayPlan.employees].sort((a, b) =>
    a.shiftStartMinute - b.shiftStartMinute
    || a.shiftEndMinute - b.shiftEndMinute
    || a.order - b.order
    || String(a.name).localeCompare(String(b.name), "ja")
  );

  for (const employee of employeesByStart) {
    if (!targetIds.has(employee.id)) addBreaksToLoad(baseBreaks[employee.id], breakLoad, config);
  }

  for (const employee of employeesByStart) {
    if (!targetIds.has(employee.id)) continue;
    const currentBreaks = normalizeBreaks(baseBreaks[employee.id]);
    const lockedBreaks = currentBreaks.filter((breakItem) => breakItem.locked);
    addBreaksToLoad(lockedBreaks, breakLoad, config);
    const mutableTemplates = removeLockedTemplates(employee.templates, lockedBreaks);
    const placed = [...lockedBreaks];

    for (const template of mutableTemplates) {
      const startMinute = chooseGreedyStart({
        employee,
        template,
        activeBySlot,
        breakLoad,
        placedBreaks: placed,
        config
      });
      if (startMinute === null) continue;
      const breakItem = {
        type: template.type,
        label: template.label,
        startMinute,
        endMinute: startMinute + template.duration
      };
      placed.push(breakItem);
      addBreaksToLoad([breakItem], breakLoad, config);
    }

    baseBreaks[employee.id] = normalizeBreaks(placed);
  }
  return baseBreaks;
}

function enumerateTemplateStarts(employee, template, config) {
  const earliest = employee.shiftStartMinute + config.edgeBufferMinutes;
  const latest = employee.shiftEndMinute - config.edgeBufferMinutes - template.duration;
  if (latest < earliest) return [];
  const starts = [];
  for (let startMinute = earliest; startMinute <= latest; startMinute += config.slotMinutes) starts.push(startMinute);
  return starts;
}

function enumerateEmployeePatterns(employee, currentBreaks, config) {
  const normalizedCurrent = normalizeBreaks(currentBreaks);
  const lockedBreaks = normalizedCurrent.filter((breakItem) => breakItem.locked);
  const mutableTemplates = removeLockedTemplates(employee.templates, lockedBreaks);
  const patterns = [];
  const placed = [...lockedBreaks];

  function walk(templateIndex) {
    if (templateIndex >= mutableTemplates.length) {
      patterns.push(normalizeBreaks(placed));
      return;
    }
    const template = mutableTemplates[templateIndex];
    for (const startMinute of enumerateTemplateStarts(employee, template, config)) {
      const candidate = {
        type: template.type,
        label: template.label,
        startMinute,
        endMinute: startMinute + template.duration
      };
      if (!isFeasibleBreak(employee, candidate, placed, config)) continue;
      placed.push(candidate);
      walk(templateIndex + 1);
      placed.pop();
    }
  }

  walk(0);
  if (!patterns.length) patterns.push(normalizedCurrent);

  const unique = new Map();
  for (const pattern of patterns) {
    const key = pattern.map((breakItem) =>
      `${breakItem.type ?? ""}:${breakItem.startMinute}-${breakItem.endMinute}:${breakItem.locked ? "1" : "0"}`
    ).join("|");
    if (!unique.has(key)) unique.set(key, pattern);
  }
  const deduped = [...unique.values()];
  if (deduped.length <= config.maxPatternsPerEmployee) return deduped;
  const ranked = deduped
    .map((pattern) => ({ pattern, priority: patternTimingDistance(employee, pattern) }))
    .sort((a, b) => a.priority - b.priority);
  const selected = ranked.slice(0, config.maxPatternsPerEmployee).map((entry) => entry.pattern);
  const currentKey = normalizedCurrent.map((breakItem) =>
    `${breakItem.type ?? ""}:${breakItem.startMinute}-${breakItem.endMinute}:${breakItem.locked ? "1" : "0"}`
  ).join("|");
  if (!selected.some((pattern) => (
    pattern.map((breakItem) =>
      `${breakItem.type ?? ""}:${breakItem.startMinute}-${breakItem.endMinute}:${breakItem.locked ? "1" : "0"}`
    ).join("|") === currentKey
  ))) selected.push(normalizedCurrent);
  return selected;
}

function patternTimingDistance(employee, pattern) {
  let score = 0;
  for (let index = 0; index < employee.templates.length; index += 1) {
    const template = employee.templates[index];
    const breakItem = pattern[index];
    if (!breakItem) continue;
    const target = employee.shiftStartMinute + template.targetOffset;
    score += Math.abs(breakItem.startMinute - target);
  }
  return score;
}

function evaluate(dayPlan, breaksByEmployee, config, includeHard = true) {
  const scoreResult = score(dayPlan, breaksByEmployee, config);
  const hard = includeHard ? checkHard(dayPlan, breaksByEmployee, config) : null;
  return {
    ...scoreResult,
    hard,
    canonical: canonicalBreaks(breaksByEmployee)
  };
}

function isBetterScore(candidate, current) {
  if (candidate.score < current.score) return true;
  if (candidate.score > current.score) return false;
  return candidate.canonical < current.canonical;
}

export function optimizeBreaks(dayPlan, options = {}) {
  const config = { ...DEFAULT_OPTIMIZER_CONFIG, ...options };
  const targetIds = [...new Set(options.targetEmployeeIds ?? dayPlan.employees.map((employee) => employee.id))];
  const initialBreaks = cloneBreakMap(
    dayPlan,
    options.initialBreaksByEmployee
      ?? createGreedyBreaks(dayPlan, { ...config, targetEmployeeIds: targetIds })
  );

  let bestOverallBreaks = cloneBreakMap(dayPlan, initialBreaks);
  const baselineEvaluation = evaluate(dayPlan, initialBreaks, config);
  let bestOverallEvaluation = baselineEvaluation;
  let totalSweeps = 0;
  const restarts = Math.max(1, Number(config.restarts) || 1);
  const employeeById = new Map(dayPlan.employees.map((employee) => [employee.id, employee]));
  const patternCache = new Map(
    targetIds.map((employeeId) => [
      employeeId,
      enumerateEmployeePatterns(employeeById.get(employeeId), initialBreaks[employeeId], config)
    ])
  );

  for (let restart = 0; restart < restarts; restart += 1) {
    const rng = createMulberry32((Number(config.seed) || 1) + restart * 9973);
    const currentBreaks = cloneBreakMap(dayPlan, initialBreaks);
    let currentEvaluation = evaluate(dayPlan, currentBreaks, config, false);
    let sweepCount = 0;
    let changed = true;

    while (changed && sweepCount < config.maxSweeps) {
      changed = false;
      sweepCount += 1;
      const order = shuffleWithRng(targetIds, rng);
      for (const employeeId of order) {
        const employee = employeeById.get(employeeId);
        if (!employee) continue;
        const patterns = patternCache.get(employeeId) ?? [currentBreaks[employeeId]];
        let bestLocalBreaks = currentBreaks[employeeId];
        let bestLocalEvaluation = currentEvaluation;
        for (const pattern of patterns) {
          const trial = { ...currentBreaks, [employeeId]: pattern };
          const trialEvaluation = evaluate(dayPlan, trial, config, false);
          if (isBetterScore(trialEvaluation, bestLocalEvaluation)) {
            bestLocalEvaluation = trialEvaluation;
            bestLocalBreaks = pattern;
          }
        }
        if (bestLocalBreaks !== currentBreaks[employeeId]) {
          currentBreaks[employeeId] = bestLocalBreaks;
          currentEvaluation = bestLocalEvaluation;
          changed = true;
        }
      }
    }

    totalSweeps += sweepCount;
    const currentFinal = evaluate(dayPlan, currentBreaks, config);
    if (isBetterScore(currentFinal, bestOverallEvaluation)) {
      bestOverallBreaks = cloneBreakMap(dayPlan, currentBreaks);
      bestOverallEvaluation = currentFinal;
    }
  }

  return {
    breaksByEmployee: bestOverallBreaks,
    score: bestOverallEvaluation.score,
    breakdown: bestOverallEvaluation.breakdown,
    baselineScore: baselineEvaluation.score,
    baselineBreakdown: baselineEvaluation.breakdown,
    hard: bestOverallEvaluation.hard,
    sweeps: totalSweeps,
    restarts
  };
}
