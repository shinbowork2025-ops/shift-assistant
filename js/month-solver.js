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
import {
  EPOCH_ITERATIONS,
  TEMPERATURE_SAMPLE_DEFAULT,
  TEMPERATURE_SAMPLE_MAX,
  TEMPERATURE_SAMPLE_MIN,
  compareStatutoryVectors,
  decideCandidateAcceptance,
  normalizeExecutionConfig,
  normalizeTemperatureScales,
  restartSeed,
  statutoryVector,
  temperatureFromPositiveDeltas
} from "./month-solver-control.js";

function clone(value) {
  return structuredClone(value);
}

function nowMilliseconds() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function calibrateMonthSolverTemperature(
  context,
  source,
  seed,
  samples = TEMPERATURE_SAMPLE_DEFAULT
) {
  const random = createSeededRandom(`${seed}:temperature`);
  const positive = [];
  const sampleCount = Math.max(
    TEMPERATURE_SAMPLE_MIN,
    Math.min(TEMPERATURE_SAMPLE_MAX, Math.floor(Number(samples) || TEMPERATURE_SAMPLE_DEFAULT))
  );
  let validCandidates = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const changes = proposeMonthSolverNeighbor(context.plan, source, random);
    if (!changes) continue;
    const evaluation = evaluateMonthSolverChanges(context, changes);
    if (!evaluation || compareStatutoryVectors(evaluation.objective, context.objective) > 0) continue;
    validCandidates += 1;
    const delta = evaluation.objective.scalar - context.objective.scalar;
    if (delta > 0 && Number.isFinite(delta)) positive.push(delta);
  }
  return {
    ...temperatureFromPositiveDeltas(positive),
    sampledCandidates: sampleCount,
    validCandidates
  };
}

function createSearch(planInput, config = {}) {
  const plan = clone(planInput);
  const context = createMonthSolverScoreContext(plan);
  const source = createMonthSolverNeighborSource(plan);
  if (!source.mutableCells.length) throw new Error("月間ソルバーで変更できる未ロックセルがありません。");
  const execution = normalizeExecutionConfig(config);
  const seed = config.masterSeed ?? config.seed ?? 1;
  const minimumTemperature = Math.max(0.000001, Number(config.minimumTemperature ?? 0.01) || 0.01);
  const calibration = Number(config.initialTemperature) > 0
    ? {
        temperature: Number(config.initialTemperature),
        medianPositiveDelta: null,
        positiveDeltaCount: 0,
        fallbackUsed: false,
        sampledCandidates: 0,
        validCandidates: 0,
        configured: true
      }
    : calibrateMonthSolverTemperature(context, source, seed, config.temperatureSamples);
  const initialTemperature = Math.max(minimumTemperature, calibration.temperature);
  const coolingRate = Math.pow(
    minimumTemperature / initialTemperature,
    1 / Math.max(1, execution.plannedBlocks)
  );
  return {
    plan,
    context,
    source,
    ...execution,
    seed,
    random: createSeededRandom(`${seed}:search`),
    initialTemperature,
    temperatureCalibration: calibration,
    temperature: initialTemperature,
    minimumTemperature,
    coolingRate,
    temperatureScaleByStrategy: normalizeTemperatureScales(config.temperatureScaleByStrategy),
    initialObjective: clone(context.objective),
    bestPlan: clone(plan),
    bestObjective: clone(context.objective),
    performed: 0,
    completedBlocks: 0,
    generated: 0,
    proposed: 0,
    accepted: 0,
    statutoryRatchetRejections: 0
  };
}

function compareBestObjectives(first, second) {
  const statutoryComparison = compareStatutoryVectors(first, second);
  if (statutoryComparison !== 0) return statutoryComparison;
  const firstInternal = [
    Number(first.internalViolationCount) || 0,
    Number(first.internalViolationAmount) || 0
  ];
  const secondInternal = [
    Number(second.internalViolationCount) || 0,
    Number(second.internalViolationAmount) || 0
  ];
  for (let index = 0; index < firstInternal.length; index += 1) {
    if (firstInternal[index] < secondInternal[index]) return -1;
    if (firstInternal[index] > secondInternal[index]) return 1;
  }
  if (first.scalar < second.scalar) return -1;
  if (first.scalar > second.scalar) return 1;
  return compareSolverObjectives(first, second);
}

function updateBest(search) {
  if (compareBestObjectives(search.context.objective, search.bestObjective) < 0) {
    search.bestPlan = clone(search.plan);
    search.bestObjective = clone(search.context.objective);
  }
}

function step(search) {
  search.performed += 1;
  const changes = proposeMonthSolverNeighbor(search.plan, search.source, search.random);
  if (!changes) return;
  search.generated += 1;
  const evaluation = evaluateMonthSolverChanges(search.context, changes);
  if (!evaluation) return;
  search.proposed += 1;
  const decision = decideCandidateAcceptance({
    currentObjective: search.context.objective,
    candidateObjective: evaluation.objective,
    temperature: search.temperature,
    strategy: "smallNeighbor",
    temperatureScaleByStrategy: search.temperatureScaleByStrategy,
    random: search.random
  });
  if (decision.reason === "statutoryRatchet") search.statutoryRatchetRejections += 1;
  if (!decision.accepted) return;
  applyMonthSolverEvaluation(search.context, evaluation);
  search.accepted += 1;
  updateBest(search);
}

function completeBlock(search) {
  search.completedBlocks += 1;
  search.temperature = Math.max(search.minimumTemperature, search.temperature * search.coolingRate);
}

function progressSnapshot(search) {
  return {
    iteration: search.performed,
    iterations: search.iterations,
    completedBlocks: search.completedBlocks,
    plannedBlocks: search.plannedBlocks,
    generatedCandidates: search.generated,
    acceptedCandidates: search.accepted,
    currentObjective: clone(search.context.objective),
    bestObjective: clone(search.bestObjective),
    bestEstimatedScore: search.bestObjective.scalar,
    statutoryViolationCount: statutoryVector(search.bestObjective)[0],
    internalViolationCount: Number(search.bestObjective.internalViolationCount) || 0,
    estimatedShortagePersonSlots: Number(search.bestObjective.shortagePeople) || 0,
    temperature: search.temperature,
    proposed: search.proposed,
    accepted: search.accepted,
    acceptanceRate: search.proposed ? search.accepted / search.proposed : 0
  };
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

function result(search, stopped, timedOut = false) {
  const validation = validateMonthSolverPlan(search.bestPlan);
  return {
    plan: search.bestPlan,
    initialObjective: search.initialObjective,
    objective: search.bestObjective,
    iterations: search.performed,
    completedBlocks: search.completedBlocks,
    plannedBlocks: search.plannedBlocks,
    generatedCandidates: search.generated,
    proposed: search.proposed,
    accepted: search.accepted,
    acceptanceRate: search.proposed ? search.accepted / search.proposed : 0,
    seed: search.seed,
    initialTemperature: search.initialTemperature,
    finalTemperature: search.temperature,
    temperatureCalibration: clone(search.temperatureCalibration),
    temperatureScaleByStrategy: clone(search.temperatureScaleByStrategy),
    stopped,
    timedOut,
    statistics: {
      completedBlocks: search.completedBlocks,
      generatedCandidates: search.generated,
      validCandidates: search.proposed,
      acceptedCandidates: search.accepted,
      statutoryRatchetRejections: search.statutoryRatchetRejections
    },
    shortageReports: shortageReports(search.bestPlan),
    validation
  };
}

function betterObjective(first, second) {
  if (!first) return second;
  if (!second) return first;
  return compareBestObjectives(first, second) <= 0 ? first : second;
}

export function solveMonthSchedule(plan, config = {}) {
  const search = createSearch(plan, config);
  while (search.performed < search.iterations) {
    const end = Math.min(search.iterations, search.performed + EPOCH_ITERATIONS);
    while (search.performed < end) step(search);
    completeBlock(search);
  }
  return result(search, false);
}

export async function solveMonthScheduleAsync(plan, config = {}, hooks = {}) {
  const search = createSearch(plan, config);
  const clock = typeof config.now === "function" ? config.now : nowMilliseconds;
  const startedAt = clock();
  let stopped = false;
  let timedOut = false;
  while (search.performed < search.iterations) {
    const blockEnd = Math.min(search.iterations, search.performed + EPOCH_ITERATIONS);
    while (search.performed < blockEnd) {
      const chunkEnd = Math.min(blockEnd, search.performed + search.yieldChunkIterations);
      while (search.performed < chunkEnd) step(search);
      if (hooks.shouldStop?.()) {
        stopped = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (search.performed > search.completedBlocks * EPOCH_ITERATIONS) {
      completeBlock(search);
      hooks.onProgress?.(progressSnapshot(search));
    }
    if (stopped) break;
    if (search.timeBudgetMs !== null && clock() - startedAt >= search.timeBudgetMs) {
      timedOut = true;
      break;
    }
  }
  return result(search, stopped, timedOut);
}

export async function solveMonthSchedulePrecisionAsync(plan, config = {}, hooks = {}) {
  const timeLimitMs = Math.max(
    20,
    Math.floor(Number(config.timeBudgetMs ?? config.timeLimitMs ?? 180000) || 180000)
  );
  const iterationsPerRestart = Math.max(100, Math.floor(Number(config.iterationsPerRestart ?? 12000) || 12000));
  const yieldChunkIterations = Math.max(
    1,
    Math.floor(Number(config.yieldChunkIterations ?? config.chunkSize ?? 120) || 120)
  );
  const configuredProgressInterval = Number(config.progressIntervalMs);
  const progressIntervalMs = Number.isFinite(configuredProgressInterval)
    ? Math.max(0, Math.floor(configuredProgressInterval))
    : 250;
  const baseSeed = config.masterSeed ?? config.seed ?? 1;
  const clock = typeof config.now === "function" ? config.now : nowMilliseconds;
  const startedAt = clock();
  const deadline = startedAt + timeLimitMs;

  let bestResult = null;
  let bestRestart = 0;
  let restarts = 0;
  let totalIterations = 0;
  let totalBlocks = 0;
  let totalGenerated = 0;
  let totalProposed = 0;
  let totalAccepted = 0;
  let totalRatchetRejections = 0;
  let manualStop = false;
  let lastProgressAt = -Infinity;

  while (!manualStop && clock() < deadline) {
    const restartNumber = restarts + 1;
    const currentRestartSeed = restartSeed(baseSeed, restartNumber);
    const completedBeforeRestart = totalIterations;
    const blocksBeforeRestart = totalBlocks;
    const generatedBeforeRestart = totalGenerated;
    const proposedBeforeRestart = totalProposed;
    const acceptedBeforeRestart = totalAccepted;

    const candidate = await solveMonthScheduleAsync(plan, {
      ...config,
      masterSeed: currentRestartSeed,
      seed: currentRestartSeed,
      iterations: iterationsPerRestart,
      fixedBlockCount: undefined,
      timeBudgetMs: undefined,
      yieldChunkIterations
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
          completedBlocks: blocksBeforeRestart + progress.completedBlocks,
          generatedCandidates: generatedBeforeRestart + progress.generatedCandidates,
          acceptedCandidates: accepted,
          currentObjective: progress.currentObjective,
          bestObjective: clone(globalBestObjective),
          bestEstimatedScore: globalBestObjective.scalar,
          statutoryViolationCount: statutoryVector(globalBestObjective)[0],
          internalViolationCount: Number(globalBestObjective.internalViolationCount) || 0,
          estimatedShortagePersonSlots: Number(globalBestObjective.shortagePeople) || 0,
          temperature: progress.temperature,
          acceptanceRate: proposed > 0 ? accepted / proposed : 0
        });
      }
    });

    restarts = restartNumber;
    totalIterations += candidate.iterations;
    totalBlocks += candidate.completedBlocks;
    totalGenerated += candidate.generatedCandidates;
    totalProposed += candidate.proposed;
    totalAccepted += candidate.accepted;
    totalRatchetRejections += candidate.statistics?.statutoryRatchetRejections ?? 0;
    if (!bestResult || compareBestObjectives(candidate.objective, bestResult.objective) < 0) {
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
        completedBlocks: totalBlocks,
        generatedCandidates: totalGenerated,
        acceptedCandidates: totalAccepted,
        currentObjective: candidate.objective,
        bestObjective: clone(bestResult.objective),
        bestEstimatedScore: bestResult.objective.scalar,
        statutoryViolationCount: statutoryVector(bestResult.objective)[0],
        internalViolationCount: Number(bestResult.objective.internalViolationCount) || 0,
        estimatedShortagePersonSlots: Number(bestResult.objective.shortagePeople) || 0,
        temperature: candidate.finalTemperature,
        acceptanceRate: totalProposed ? totalAccepted / totalProposed : 0
      });
    }
  }

  if (!bestResult) {
    bestResult = await solveMonthScheduleAsync(plan, {
      ...config,
      masterSeed: restartSeed(baseSeed, 1),
      seed: restartSeed(baseSeed, 1),
      iterations: Math.min(iterationsPerRestart, 500),
      fixedBlockCount: undefined,
      timeBudgetMs: undefined,
      yieldChunkIterations
    }, {
      shouldStop: () => Boolean(hooks.shouldStop?.())
    });
    restarts = 1;
    bestRestart = 1;
    totalIterations = bestResult.iterations;
    totalBlocks = bestResult.completedBlocks;
    totalGenerated = bestResult.generatedCandidates;
    totalProposed = bestResult.proposed;
    totalAccepted = bestResult.accepted;
    totalRatchetRejections = bestResult.statistics?.statutoryRatchetRejections ?? 0;
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
    completedBlocks: totalBlocks,
    generatedCandidates: totalGenerated,
    proposed: totalProposed,
    accepted: totalAccepted,
    acceptanceRate: totalProposed ? totalAccepted / totalProposed : 0,
    elapsedMs,
    timeLimitMs,
    iterationsPerRestart,
    statistics: {
      ...bestResult.statistics,
      completedBlocks: totalBlocks,
      generatedCandidates: totalGenerated,
      validCandidates: totalProposed,
      acceptedCandidates: totalAccepted,
      statutoryRatchetRejections: totalRatchetRejections,
      restarts
    },
    stopped: manualStop,
    timedOut,
    optimalityGuaranteed: false
  };
}
