import { applyMonthEvaluation, checkHardMonth, createMonthScoreContext, evaluateMonthChanges } from "./scoringMonth.js";
import { createMonthNeighborSource, proposeMonthNeighbor } from "./month-neighbors.js";
import { mulberry32 } from "./rng.js";

const EPSILON = 1e-9;

function clonePlan(plan) {
  return structuredClone(plan);
}

function assignmentSignature(plan) {
  return JSON.stringify(plan.assignments);
}

function median(values) {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function calibrateTemperature(plan, context, source, config, seed) {
  const configured = Number(config.initialTemperature);
  if (Number.isFinite(configured) && configured > 0) return configured;

  // 中央的な悪化量を50%で受理する温度 T = Δ / ln(2) を使う。
  // サンプル生成も別シードの自前乱数で行うため、同じ入力・シードなら常に同じ温度になる。
  const random = mulberry32(`${seed}:temperature`);
  const positiveDeltas = [];
  const samples = Math.max(16, Math.floor(Number(config.temperatureSamples ?? 64) || 64));
  for (let index = 0; index < samples; index += 1) {
    const changes = proposeMonthNeighbor(plan, source, random);
    if (!changes) continue;
    const evaluation = evaluateMonthChanges(context, changes);
    if (!evaluation) continue;
    const delta = evaluation.result.total - context.result.total;
    if (delta > EPSILON) positiveDeltas.push(delta);
  }
  return Math.max(1, median(positiveDeltas) / Math.log(2));
}

function createSearch(planInput, config = {}) {
  const plan = clonePlan(planInput);
  const seed = config.seed ?? 1;
  const iterations = Math.max(1, Math.floor(Number(config.iterations ?? 12000) || 12000));
  const context = createMonthScoreContext(plan, config);
  const source = createMonthNeighborSource(plan);
  if (!source.mutableCells.length) throw new Error("探索対象となる未固定セルがありません。");
  const initialTemperature = calibrateTemperature(plan, context, source, config, seed);
  const minimumTemperature = Math.max(0.000001, Number(config.minimumTemperature ?? 0.01) || 0.01);
  const configuredCooling = Number(config.coolingRate);
  const coolingRate = Number.isFinite(configuredCooling) && configuredCooling > 0 && configuredCooling < 1
    ? configuredCooling
    : Math.pow(minimumTemperature / initialTemperature, 1 / iterations);

  return {
    plan,
    context,
    source,
    seed,
    iterations,
    random: mulberry32(`${seed}:search`),
    temperature: initialTemperature,
    initialTemperature,
    minimumTemperature,
    coolingRate,
    bestPlan: clonePlan(plan),
    bestResult: structuredClone(context.result),
    bestSignature: assignmentSignature(plan),
    accepted: 0,
    proposed: 0,
    performed: 0
  };
}

function updateBest(search) {
  const total = search.context.result.total;
  const signature = assignmentSignature(search.plan);
  if (
    total < search.bestResult.total - EPSILON
    || (Math.abs(total - search.bestResult.total) <= EPSILON && signature < search.bestSignature)
  ) {
    search.bestPlan = clonePlan(search.plan);
    search.bestResult = structuredClone(search.context.result);
    search.bestSignature = signature;
  }
}

function searchStep(search) {
  const changes = proposeMonthNeighbor(search.plan, search.source, search.random);
  search.performed += 1;
  search.temperature = Math.max(search.minimumTemperature, search.temperature * search.coolingRate);
  if (!changes) return;
  const evaluation = evaluateMonthChanges(search.context, changes);
  if (!evaluation) return;
  search.proposed += 1;
  const delta = evaluation.result.total - search.context.result.total;
  const accepted = delta <= 0 || search.random() < Math.exp(-delta / Math.max(search.temperature, 0.000001));
  if (!accepted) return;
  applyMonthEvaluation(search.context, evaluation);
  search.accepted += 1;
  updateBest(search);
}

function finishSearch(search, stopped = false) {
  const hardCheck = checkHardMonth(search.bestPlan, search.context.config);
  return {
    plan: search.bestPlan,
    score: search.bestResult.total,
    breakdown: search.bestResult.breakdown,
    employeeStats: search.bestResult.employeeStats,
    initialScore: createMonthScoreContext(clonePlan(search.plan), search.context.config).result.total,
    iterations: search.performed,
    accepted: search.accepted,
    proposed: search.proposed,
    acceptanceRate: search.proposed ? search.accepted / search.proposed : 0,
    seed: search.seed,
    initialTemperature: search.initialTemperature,
    finalTemperature: search.temperature,
    stopped,
    hardCheck
  };
}

export function optimizeMonthSchedule(plan, config = {}) {
  const search = createSearch(plan, config);
  const initialScore = search.context.result.total;
  for (let index = 0; index < search.iterations; index += 1) searchStep(search);
  const result = finishSearch(search, false);
  result.initialScore = initialScore;
  return result;
}

export async function optimizeMonthScheduleAsync(plan, config = {}, hooks = {}) {
  const search = createSearch(plan, config);
  const initialScore = search.context.result.total;
  const chunkSize = Math.max(10, Math.floor(Number(config.chunkSize ?? 200) || 200));
  const progressEvery = Math.max(chunkSize, Math.floor(Number(config.progressEvery ?? 400) || 400));
  let stopped = false;

  while (search.performed < search.iterations) {
    const end = Math.min(search.iterations, search.performed + chunkSize);
    while (search.performed < end) searchStep(search);
    if (search.performed % progressEvery === 0 || search.performed === search.iterations) {
      hooks.onProgress?.({
        iteration: search.performed,
        iterations: search.iterations,
        currentScore: search.context.result.total,
        bestScore: search.bestResult.total,
        temperature: search.temperature,
        acceptanceRate: search.proposed ? search.accepted / search.proposed : 0
      });
    }
    if (hooks.shouldStop?.()) {
      stopped = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const result = finishSearch(search, stopped);
  result.initialScore = initialScore;
  return result;
}
