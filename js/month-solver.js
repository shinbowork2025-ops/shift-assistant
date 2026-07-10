import { createSeededRandom } from "./month-solver-rng.js";
import {
  applyMonthSolverEvaluation,
  compareSolverObjectives,
  createMonthSolverScoreContext,
  evaluateMonthSolverChanges,
  validateMonthSolverPlan
} from "./month-solver-score.js";
import {
  createMonthSolverNeighborSource,
  proposeMonthSolverNeighbor
} from "./month-solver-neighbors.js";

function clone(value) {
  return structuredClone(value);
}

function nowMilliseconds() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function calibrateTemperature(context, source, seed, hardCeiling, samples = 48) {
  const random = createSeededRandom(`${seed}:temperature`);
  const positive = [];
  for (let index = 0; index < samples; index += 1) {
    const changes = proposeMonthSolverNeighbor(context.plan, source, random);
    if (!changes) continue;
    const evaluation = evaluateMonthSolverChanges(context, changes);
    if (!evaluation || evaluation.objective.hard > hardCeiling) continue;
    const delta = evaluation.objective.scalar - context.objective.scalar;
    if (delta > 0 && Number.isFinite(delta)) positive.push(delta);
  }
  if (!positive.length) return 1;
  positive.sort((a, b) => a - b);
  const median = positive[Math.floor(positive.length / 2)];
  return Math.max(1, median / Math.log(2));
}

function createSearch(planInput, config = {}) {
  const plan = clone(planInput);
  const context = createMonthSolverScoreContext(plan);
  const source = createMonthSolverNeighborSource(plan);
  if (!source.mutableCells.length) throw new Error("月間ソルバーで変更できる未ロックセルがありません。");
  const iterations = Math.max(100, Math.floor(Number(config.iterations ?? 8000) || 8000));
  const seed = config.seed ?? 1;
  // 勤務間隔・連勤違反は初期案より増やさない。
  // 初期案が違反ゼロなら、必要人数を埋めるためでも新しい違反は導入しない。
  const hardCeiling = Math.max(0, Number(context.objective.hard) || 0);
  const initialTemperature = Number(config.initialTemperature) > 0
    ? Number(config.initialTemperature)
    : calibrateTemperature(context, source, seed, hardCeiling, Number(config.temperatureSamples ?? 48));
  const minimumTemperature = Math.max(0.000001, Number(config.minimumTemperature ?? 0.01) || 0.01);
  const coolingRate = Math.pow(minimumTemperature / initialTemperature, 1 / iterations);
  return {
    plan,
    context,
    source,
    iterations,
    seed,
    random: createSeededRandom(`${seed}:search`),
    initialTemperature,
    temperature: initialTemperature,
    minimumTemperature,
    coolingRate,
    hardCeiling,
    initialObjective: clone(context.objective),
    bestPlan: clone(plan),
    bestObjective: clone(context.objective),
    performed: 0,
    proposed: 0,
    accepted: 0
  };
}

function updateBest(search) {
  if (compareSolverObjectives(search.context.objective, search.bestObjective) < 0) {
    search.bestPlan = clone(search.plan);
    search.bestObjective = clone(search.context.objective);
  }
}

function step(search) {
  search.performed += 1;
  search.temperature = Math.max(search.minimumTemperature, search.temperature * search.coolingRate);
  const changes = proposeMonthSolverNeighbor(search.plan, search.source, search.random);
  if (!changes) return;
  const evaluation = evaluateMonthSolverChanges(search.context, changes);
  if (!evaluation || evaluation.objective.hard > search.hardCeiling) return;
  search.proposed += 1;
  const comparison = compareSolverObjectives(evaluation.objective, search.context.objective);
  const delta = evaluation.objective.scalar - search.context.objective.scalar;
  const accept = comparison <= 0
    || search.random() < Math.exp(-Math.max(0, delta) / Math.max(search.temperature, 0.000001));
  if (!accept) return;
  applyMonthSolverEvaluation(search.context, evaluation);
  search.accepted += 1;
  updateBest(search);
}

function shortageReports(plan) {
  const context = createMonthSolverScoreContext(plan);
  return [...context.dayMetrics.values()]
    .filter((metric) => metric.shortagePeople > 0)
    .map((metric) => ({
      day: metric.day,
      shortagePeople: metric.shortagePeople,
      shortageSlots: metric.shortageSlots,
      messages: metric.requirementMessages
    }));
}

function result(search, stopped) {
  const validation = validateMonthSolverPlan(search.bestPlan);
  return {
    plan: search.bestPlan,
    initialObjective: search.initialObjective,
    objective: search.bestObjective,
    iterations: search.performed,
    proposed: search.proposed,
    accepted: search.accepted,
    acceptanceRate: search.proposed ? search.accepted / search.proposed : 0,
    seed: search.seed,
    initialTemperature: search.initialTemperature,
    finalTemperature: search.temperature,
    stopped,
    shortageReports: shortageReports(search.bestPlan),
    validation
  };
}

function betterObjective(first, second) {
  if (!first) return second;
  if (!second) return first;
  return compareSolverObjectives(first, second) <= 0 ? first : second;
}

export function solveMonthSchedule(plan, config = {}) {
  const search = createSearch(plan, config);
  for (let index = 0; index < search.iterations; index += 1) step(search);
  return result(search, false);
}

export async function solveMonthScheduleAsync(plan, config = {}, hooks = {}) {
  const search = createSearch(plan, config);
  const chunkSize = Math.max(20, Math.floor(Number(config.chunkSize ?? 120) || 120));
  const progressEvery = Math.max(chunkSize, Math.floor(Number(config.progressEvery ?? 360) || 360));
  let stopped = false;
  while (search.performed < search.iterations) {
    const end = Math.min(search.iterations, search.performed + chunkSize);
    while (search.performed < end) step(search);
    if (search.performed % progressEvery === 0 || search.performed === search.iterations) {
      hooks.onProgress?.({
        iteration: search.performed,
        iterations: search.iterations,
        currentObjective: clone(search.context.objective),
        bestObjective: clone(search.bestObjective),
        temperature: search.temperature,
        proposed: search.proposed,
        accepted: search.accepted,
        acceptanceRate: search.proposed ? search.accepted / search.proposed : 0
      });
    }
    if (hooks.shouldStop?.()) {
      stopped = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return result(search, stopped);
}

export async function solveMonthSchedulePrecisionAsync(plan, config = {}, hooks = {}) {
  const timeLimitMs = Math.max(20, Math.floor(Number(config.timeLimitMs ?? 180000) || 180000));
  const iterationsPerRestart = Math.max(100, Math.floor(Number(config.iterationsPerRestart ?? 12000) || 12000));
  const chunkSize = Math.max(20, Math.floor(Number(config.chunkSize ?? 120) || 120));
  const progressEvery = Math.max(chunkSize, Math.floor(Number(config.progressEvery ?? 360) || 360));
  const configuredProgressInterval = Number(config.progressIntervalMs);
  const progressIntervalMs = Number.isFinite(configuredProgressInterval)
    ? Math.max(0, Math.floor(configuredProgressInterval))
    : 250;
  const baseSeed = config.seed ?? 1;
  const clock = typeof config.now === "function" ? config.now : nowMilliseconds;
  const startedAt = clock();
  const deadline = startedAt + timeLimitMs;

  let bestResult = null;
  let bestRestart = 0;
  let restarts = 0;
  let totalIterations = 0;
  let totalProposed = 0;
  let totalAccepted = 0;
  let manualStop = false;
  let lastProgressAt = -Infinity;

  while (!manualStop && clock() < deadline) {
    const restartNumber = restarts + 1;
    const restartSeed = `${baseSeed}:precision:${restartNumber}`;
    const completedBeforeRestart = totalIterations;
    const proposedBeforeRestart = totalProposed;
    const acceptedBeforeRestart = totalAccepted;

    const candidate = await solveMonthScheduleAsync(plan, {
      ...config,
      seed: restartSeed,
      iterations: iterationsPerRestart,
      chunkSize,
      progressEvery
    }, {
      shouldStop: () => {
        manualStop = Boolean(hooks.shouldStop?.());
        return manualStop || clock() >= deadline;
      },
      onProgress: (progress) => {
        const currentTime = clock();
        const globalBestObjective = betterObjective(bestResult?.objective, progress.bestObjective);
        if (currentTime - lastProgressAt < progressIntervalMs && currentTime < deadline) return;
        lastProgressAt = currentTime;
        const proposed = proposedBeforeRestart + progress.proposed;
        const accepted = acceptedBeforeRestart + progress.accepted;
        hooks.onProgress?.({
          mode: "precision",
          elapsedMs: Math.max(0, currentTime - startedAt),
          timeLimitMs,
          restart: restartNumber,
          restarts,
          iteration: completedBeforeRestart + progress.iteration,
          currentObjective: progress.currentObjective,
          bestObjective: clone(globalBestObjective),
          temperature: progress.temperature,
          acceptanceRate: proposed > 0 ? accepted / proposed : 0
        });
      }
    });

    restarts = restartNumber;
    totalIterations += candidate.iterations;
    totalProposed += candidate.proposed;
    totalAccepted += candidate.accepted;
    if (!bestResult || compareSolverObjectives(candidate.objective, bestResult.objective) < 0) {
      bestResult = candidate;
      bestRestart = restartNumber;
    }

    manualStop = manualStop || Boolean(hooks.shouldStop?.());
    const currentTime = clock();
    if (currentTime - lastProgressAt >= progressIntervalMs || currentTime >= deadline || manualStop) {
      lastProgressAt = currentTime;
      hooks.onProgress?.({
        mode: "precision",
        elapsedMs: Math.max(0, currentTime - startedAt),
        timeLimitMs,
        restart: restartNumber,
        restarts,
        iteration: totalIterations,
        currentObjective: candidate.objective,
        bestObjective: clone(bestResult.objective),
        temperature: candidate.finalTemperature,
        acceptanceRate: totalProposed ? totalAccepted / totalProposed : 0
      });
    }
  }

  if (!bestResult) {
    bestResult = await solveMonthScheduleAsync(plan, {
      ...config,
      seed: `${baseSeed}:precision:1`,
      iterations: Math.min(iterationsPerRestart, 500),
      chunkSize,
      progressEvery
    }, {
      shouldStop: () => Boolean(hooks.shouldStop?.())
    });
    restarts = 1;
    bestRestart = 1;
    totalIterations = bestResult.iterations;
    totalProposed = bestResult.proposed;
    totalAccepted = bestResult.accepted;
    manualStop = Boolean(hooks.shouldStop?.());
  }

  const elapsedMs = Math.max(0, clock() - startedAt);
  const timedOut = !manualStop && elapsedMs >= timeLimitMs;
  return {
    ...bestResult,
    mode: "precision",
    seed: baseSeed,
    bestRestart,
    restarts,
    iterations: totalIterations,
    proposed: totalProposed,
    accepted: totalAccepted,
    acceptanceRate: totalProposed ? totalAccepted / totalProposed : 0,
    elapsedMs,
    timeLimitMs,
    iterationsPerRestart,
    stopped: manualStop,
    timedOut,
    optimalityGuaranteed: false
  };
}
