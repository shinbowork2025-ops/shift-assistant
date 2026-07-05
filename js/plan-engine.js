import { checkHard, createScoreContext, score } from "./scoring.js";
import { compileRestCandidate } from "./rest-candidate.js";
import { enumerateBreakPatterns, restCandidateCacheKey, restSignature } from "./rest-pattern-enumerator.js";
import { mulberry32 } from "./rng.js";
import { runStep } from "./improve-step.js";

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

function breakMap(dayPlan) {
  return Object.fromEntries(dayPlan.employees.map((employee) => [
    employee.id,
    employee.breaks.map((item) => ({ ...item }))
  ]));
}

function compiledCandidate(items) {
  return {
    ...compileRestCandidate(items),
    signature: restSignature(items)
  };
}

function buildCandidateMap(initialPlan, config) {
  const cache = new Map();
  const result = new Map();
  for (const employee of initialPlan.employees) {
    const key = restCandidateCacheKey(employee, config);
    if (!cache.has(key)) cache.set(key, enumerateBreakPatterns(employee, config).map(compiledCandidate));
    result.set(employee.id, cache.get(key));
  }
  return result;
}

export function improvePlan(dayPlan, config = {}) {
  const initialPlan = clonePlan(dayPlan);
  const initialScore = score(initialPlan, config);
  buildCandidateMap(initialPlan, config);
  return {
    breaks: breakMap(initialPlan),
    score: initialScore.total,
    breakdown: initialScore.breakdown,
    initialScore: initialScore.total,
    initialBreakdown: initialScore.breakdown,
    iterations: 0,
    restarts: 0,
    seed: config.seed ?? 1,
    hardCheck: checkHard(initialPlan, config)
  };
}
