import {
  applyBreakReplacement,
  checkHard,
  createScoreContext,
  evaluateBreakReplacement,
  score
} from "./scoring.js";
import { mulberry32, shuffled } from "./rng.js";

const GRID_MINUTES = 15;
const EPSILON = 1e-9;

function clonePlan(dayPlan) {
  return {
    ...dayPlan,
    employees: (dayPlan?.employees ?? []).map((employee) => ({
      ...employee,
      breaks: (employee.breaks ?? []).map((item) => ({ ...item }))
    }))
  };
}

function durationOf(item) {
  return Math.max(0, Number(item.end) - Number(item.start));
}

function patternOptions(spanMinutes) {
  if (spanMinutes <= 240) return [[]];
  if (spanMinutes <= 375) return [[15]];
  if (spanMinutes <= 525) return [[45], [30, 15]];
  return [[15, 60, 15]];
}

function defaultTargets(shiftStart, shiftEnd, durations) {
  const span = shiftEnd - shiftStart;
  if (durations.length === 1 && durations[0] === 15) return [shiftStart + 120];
  if (durations.length === 1) return [shiftStart + Math.round((span - durations[0]) / 2)];
  if (durations.join(",") === "15,60,15") {
    return [
      shiftStart + 120,
      shiftStart + Math.max(180, Math.round((span - 60) / 2)),
      shiftStart + Math.max(300, span - 105)
    ];
  }
  return durations.map((duration, index) => {
    const center = shiftStart + Math.round(span * (index + 1) / (durations.length + 1));
    return center - Math.floor(duration / 2);
  });
}

function breakMetadata(duration, target) {
  return duration <= 15
    ? { type: "small", label: "小休憩", target }
    : { type: "lunch", label: "昼休憩", target };
}

function consumeLockedDurations(option, locked) {
  const remaining = [...option];
  for (const item of locked) {
    const duration = durationOf(item);
    const index = remaining.indexOf(duration);
    if (index < 0) return null;
    remaining.splice(index, 1);
  }
  return remaining;
}

function compatible(candidate, existing, minimumGapMinutes) {
  for (const item of existing) {
    if (candidate.start < item.end && item.start < candidate.end) return false;
    const gap = candidate.end <= item.start
      ? item.start - candidate.end
      : candidate.start - item.end;
    if (gap < minimumGapMinutes) return false;
  }
  return true;
}

function signature(breaks) {
  return [...breaks]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((item) => `${item.start}-${item.end}-${item.locked ? 1 : 0}`)
    .join("|");
}

export function enumerateBreakPatterns(employee, config = {}) {
  if (employee.fixedBreaks) return [(employee.breaks ?? []).map((item) => ({ ...item }))];
  const edge = Math.max(0, Number(config.edgeBufferMinutes ?? 60) || 0);
  const minimumGapMinutes = Math.max(0, Number(config.minimumBreakGapMinutes ?? 60) || 0);
  const shiftStart = Number(employee.shiftStart);
  const shiftEnd = Number(employee.shiftEnd);
  const locked = (employee.breaks ?? []).filter((item) => item.locked).map((item) => ({ ...item }));
  const options = patternOptions(shiftEnd - shiftStart);
  const results = new Map();

  for (const option of options) {
    const remaining = consumeLockedDurations(option, locked);
    if (!remaining) continue;
    const targets = defaultTargets(shiftStart, shiftEnd, remaining);

    function visit(index, placed) {
      if (index >= remaining.length) {
        const complete = [...locked, ...placed].sort((a, b) => a.start - b.start || a.end - b.end);
        const candidateEmployee = { ...employee, breaks: complete };
        if (checkHard({ employees: [candidateEmployee] }, config).ok) results.set(signature(complete), complete);
        return;
      }

      const duration = remaining[index];
      const earliest = shiftStart + edge;
      const latest = shiftEnd - edge - duration;
      for (let start = Math.ceil(earliest / GRID_MINUTES) * GRID_MINUTES; start <= latest; start += GRID_MINUTES) {
        const candidate = {
          ...breakMetadata(duration, targets[index]),
          start,
          end: start + duration,
          locked: false
        };
        if (compatible(candidate, [...locked, ...placed], minimumGapMinutes)) visit(index + 1, [...placed, candidate]);
      }
    }

    visit(0, []);
  }

  if (results.size === 0 && checkHard({ employees: [employee] }, config).ok) {
    results.set(signature(employee.breaks ?? []), (employee.breaks ?? []).map((item) => ({ ...item })));
  }
  return [...results.values()].sort((a, b) => signature(a).localeCompare(signature(b)));
}

function withEmployeeBreaks(dayPlan, employeeId, breaks) {
  return {
    ...dayPlan,
    employees: dayPlan.employees.map((employee) => employee.id === employeeId
      ? { ...employee, breaks: breaks.map((item) => ({ ...item })) }
      : employee)
  };
}

function breakMap(dayPlan) {
  return Object.fromEntries(dayPlan.employees.map((employee) => [
    employee.id,
    employee.breaks.map((item) => ({ ...item }))
  ]));
}

function currentEmployee(dayPlan, employeeId) {
  return dayPlan.employees.find((employee) => employee.id === employeeId);
}

export function optimizeBreaks(dayPlan, config = {}) {
  const restarts = Math.max(1, Math.floor(Number(config.restarts ?? 3) || 3));
  const maxPasses = Math.max(1, Math.floor(Number(config.maxPasses ?? 20) || 20));
  const seed = config.seed ?? 1;
  const initialPlan = clonePlan(dayPlan);
  const initialScore = score(initialPlan, config);
  const candidatesByEmployee = new Map(initialPlan.employees.map((employee) => [
    employee.id,
    enumerateBreakPatterns(employee, config)
  ]));
  let bestPlan = initialPlan;
  let bestScore = initialScore;
  let totalPasses = 0;

  for (let restart = 0; restart < restarts; restart += 1) {
    const random = mulberry32(`${seed}:${restart}`);
    let currentPlan = clonePlan(initialPlan);
    const context = createScoreContext(currentPlan, config);

    for (let pass = 0; pass < maxPasses; pass += 1) {
      totalPasses += 1;
      let improved = false;
      const order = shuffled(currentPlan.employees.map((employee) => employee.id), random);

      for (const employeeId of order) {
        const employee = currentEmployee(currentPlan, employeeId);
        const previousItems = employee?.breaks ?? [];
        const candidates = candidatesByEmployee.get(employeeId) ?? [];
        const feasibleSignatures = new Set(candidates.map(signature));
        const forceReplacement = !feasibleSignatures.has(signature(previousItems))
          || !checkHard({ employees: [employee] }, config).ok;
        let selectedCandidate = null;
        let selectedEvaluation = null;
        let selectedSignature = "";

        for (const candidate of candidates) {
          const evaluation = evaluateBreakReplacement(context, previousItems, candidate);
          const candidateSignature = signature(candidate);
          if (
            selectedEvaluation === null
            || evaluation.total < selectedEvaluation.total - EPSILON
            || (Math.abs(evaluation.total - selectedEvaluation.total) <= EPSILON && candidateSignature < selectedSignature)
          ) {
            selectedCandidate = candidate;
            selectedEvaluation = evaluation;
            selectedSignature = candidateSignature;
          }
        }

        if (!selectedCandidate || !selectedEvaluation) continue;
        if (forceReplacement || selectedEvaluation.total < context.result.total - EPSILON) {
          currentPlan = withEmployeeBreaks(currentPlan, employeeId, selectedCandidate);
          applyBreakReplacement(context, selectedEvaluation);
          improved = true;
        }
      }

      if (!improved) break;
    }

    const currentScore = context.result;
    const currentSignature = JSON.stringify(breakMap(currentPlan));
    const bestSignature = JSON.stringify(breakMap(bestPlan));
    if (
      currentScore.total < bestScore.total - EPSILON
      || (Math.abs(currentScore.total - bestScore.total) <= EPSILON && currentSignature < bestSignature)
    ) {
      bestPlan = currentPlan;
      bestScore = currentScore;
    }
  }

  return {
    breaks: breakMap(bestPlan),
    score: bestScore.total,
    breakdown: bestScore.breakdown,
    initialScore: initialScore.total,
    initialBreakdown: initialScore.breakdown,
    iterations: totalPasses,
    restarts,
    seed,
    hardCheck: checkHard(bestPlan, config)
  };
}
