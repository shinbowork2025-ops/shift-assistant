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

function runRestart(initialPlan, candidatesByEmployee, config, restart, maxPasses) {
  const random = mulberry32(`${config.seed ?? 1}:${restart}`);
  let plan = clonePlan(initialPlan);
  const context = createScoreContext(plan, config);
  const currentCandidates = new Map(plan.employees.map((employee) => [
    employee.id,
    compiledCandidate(employee.breaks)
  ]));
  let passes = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    passes += 1;
    const next = runStep(plan, context, currentCandidates, candidatesByEmployee, random, config);
    plan = next.plan;
    if (!next.improved) break;
  }
  return { plan, result: context.result, passes };
}

export function improvePlan(dayPlan, config = {}) {
  const restarts = Math.max(1, Math.floor(Number(config.restarts ?? 3) || 3));
  const maxPasses = Math.max(1, Math.floor(Number(config.maxPasses ?? 20) || 20));
  const initialPlan = clonePlan(dayPlan);
  const initialScore = score(initialPlan, config);
  const candidatesByEmployee = buildCandidateMap(initialPlan, config);
  let bestPlan = initialPlan;
  let bestScore = initialScore;
  let totalPasses = 0;

  for (let restart = 0; restart < restarts; restart += 1) {
    const current = runRestart(initialPlan, candidatesByEmployee, config, restart, maxPasses);
    totalPasses += current.passes;
    const currentSignature = JSON.stringify(breakMap(current.plan));
    const bestSignature = JSON.stringify(breakMap(bestPlan));
    if (
      current.result.total < bestScore.total - EPSILON
      || (Math.abs(current.result.total - bestScore.total) <= EPSILON && currentSignature < bestSignature)
    ) {
      bestPlan = current.plan;
      bestScore = current.result;
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
    seed: config.seed ?? 1,
    hardCheck: checkHard(bestPlan, config)
  };
}
