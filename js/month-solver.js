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
import { proposeMonthSolverRepair } from "./month-solver-repair.js";
import {
  normalizeMonthSolverStrategyWeights,
  proposeMonthSolverLns,
  selectMonthSolverStrategy
} from "./month-solver-lns.js";
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
import {
  classifyEstimatedCandidate,
  considerCandidate,
  createCandidateArchives
} from "./month-solver-archive.js";
import {
  compareFinalizedCandidates,
  finalizeMonthSolverCandidates
} from "./month-solver-finalize.js";
import {
  RESTART_STAGNATION_BLOCKS,
  adaptMonthSolverStrategyWeights,
  adaptiveStrategyEnabled,
  repairSizeForStagnation,
  restartStrategyWeights,
  strategyReward
} from "./month-solver-adaptation.js";

function clone(value) {
  return structuredClone(value);
}

function nowMilliseconds() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function createStrategyStatistics() {
  const common = () => ({
    selections: 0,
    attempts: 0,
    generatedCandidates: 0,
    validCandidates: 0,
    evaluatedCandidates: 0,
    acceptedCandidates: 0,
    currentImprovements: 0,
    bestUpdates: 0,
    feasibleCandidates: 0,
    totalChangedCells: 0
  });
  return {
    smallNeighbor: {
      ...common()
    },
    repair: {
      ...common(),
      bruteAttempts: 0,
      beamAttempts: 0,
      greedyBeamAttempts: 0
    },
    lns: {
      ...common(),
      invariantRejections: 0,
      bruteAttempts: 0,
      beamAttempts: 0,
      greedyBeamAttempts: 0,
      destroyMethods: {
        violation: 0,
        shortageDay: 0,
        employeeWeek: 0,
        multipleEmployees: 0,
        random: 0
      }
    }
  };
}

function createStrategyTiming() {
  return Object.fromEntries(["smallNeighbor", "repair", "lns"].map((strategy) => [strategy, {
    samples: 0,
    totalMilliseconds: 0
  }]));
}

function addNumericStatistics(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (key === "averageChangedCells") continue;
    if (value && typeof value === "object") {
      target[key] ??= {};
      addNumericStatistics(target[key], value);
    } else {
      target[key] = (Number(target[key]) || 0) + (Number(value) || 0);
    }
  }
  return target;
}

function addStrategyStatistics(target, source) {
  return addNumericStatistics(target, source);
}

function incrementNumericPath(target, path, amount = 1) {
  const keys = Array.isArray(path) ? path : [path];
  let current = target;
  for (const key of keys.slice(0, -1)) {
    current[key] ??= {};
    current = current[key];
  }
  const key = keys.at(-1);
  current[key] = (Number(current[key]) || 0) + amount;
}

function recordStrategyStatistic(search, strategy, path, amount = 1) {
  incrementNumericPath(search.strategyStatistics[strategy], path, amount);
  incrementNumericPath(search.blockStrategyStatistics[strategy], path, amount);
}

function timedStrategyProposal(search, strategy, proposal) {
  const startedAt = nowMilliseconds();
  try {
    return proposal();
  } finally {
    const timing = search.strategyTiming[strategy];
    timing.samples += 1;
    timing.totalMilliseconds += Math.max(0, nowMilliseconds() - startedAt);
  }
}

function summarizedStrategyStatistics(input) {
  const statistics = clone(input);
  for (const values of Object.values(statistics)) {
    values.averageChangedCells = values.validCandidates > 0
      ? values.totalChangedCells / values.validCandidates
      : 0;
  }
  return statistics;
}

function strategyTimingSnapshot(search) {
  return Object.fromEntries(Object.entries(search.strategyTiming).map(([strategy, values]) => [strategy, {
    ...values,
    averageProcessingTimeMs: values.samples > 0 ? values.totalMilliseconds / values.samples : 0
  }]));
}

function repairMethodStatisticsKey(method) {
  return method === "brute"
    ? "bruteAttempts"
    : method === "greedyBeam"
      ? "greedyBeamAttempts"
      : "beamAttempts";
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
  const archives = createCandidateArchives(config);
  const configuredStrategyWeights = {
    ...(config.strategyWeights ?? {})
  };
  if (config.enableRepair === false) configuredStrategyWeights.repair = 0;
  if (config.enableLns === false) configuredStrategyWeights.lns = 0;
  const initialStrategyWeights = normalizeMonthSolverStrategyWeights(configuredStrategyWeights);
  considerCandidate(archives, {
    plan,
    objective: context.objective,
    dayMetrics: context.dayMetrics
  });
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
    strategyWeights: initialStrategyWeights,
    baseStrategyWeights: clone(initialStrategyWeights),
    adaptiveStrategyEnabled: adaptiveStrategyEnabled(execution.plannedBlocks, config.adaptiveStrategy),
    strategyWeightHistory: [],
    repairOptions: {
      enabled: config.enableRepair !== false,
      configuredCellCount: config.repairCellCount !== null
        && config.repairCellCount !== undefined
        && config.repairCellCount !== ""
        && Number.isFinite(Number(config.repairCellCount))
        ? Math.max(1, Math.floor(Number(config.repairCellCount)))
        : null,
      beamWidth: config.repairBeamWidth,
      exactCandidateCap: config.repairExactCandidateCap
    },
    lnsOptions: {
      enabled: config.enableLns !== false,
      configuredDestroySize: config.lnsDestroySize !== null
        && config.lnsDestroySize !== undefined
        && config.lnsDestroySize !== ""
        && Number.isFinite(Number(config.lnsDestroySize))
        ? Math.max(1, Math.floor(Number(config.lnsDestroySize)))
        : null,
      beamWidth: config.lnsBeamWidth ?? config.repairBeamWidth,
      exactCandidateCap: config.lnsExactCandidateCap ?? 1
    },
    strategyStatistics: createStrategyStatistics(),
    blockStrategyStatistics: createStrategyStatistics(),
    strategyTiming: createStrategyTiming(),
    archives,
    initialObjective: clone(context.objective),
    bestPlan: clone(plan),
    bestObjective: clone(context.objective),
    performed: 0,
    completedBlocks: 0,
    generated: 0,
    proposed: 0,
    accepted: 0,
    statutoryRatchetRejections: 0,
    stagnationBlocks: 0,
    restartStagnationBlocks: Math.max(
      1,
      Math.floor(Number(config.restartStagnationBlocks ?? RESTART_STAGNATION_BLOCKS)
        || RESTART_STAGNATION_BLOCKS)
    ),
    restartEnabled: config.enableSearchRestart !== false,
    searchRestarts: 0,
    restartIterations: [],
    restartSeeds: []
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
    return true;
  }
  return false;
}

function activeRepairSize(search) {
  return repairSizeForStagnation(
    search.stagnationBlocks,
    search.completedBlocks,
    search.restartStagnationBlocks
  );
}

function step(search) {
  search.performed += 1;
  const selectedStrategy = selectMonthSolverStrategy(search.random, search.strategyWeights);
  recordStrategyStatistic(search, selectedStrategy, "selections");
  let strategy = selectedStrategy;
  let evaluation = null;
  let changes = null;
  if (selectedStrategy === "repair" && search.repairOptions.enabled) {
    recordStrategyStatistic(search, "repair", "attempts");
    const repair = timedStrategyProposal(search, "repair", () => proposeMonthSolverRepair(
      search.context,
      search.source,
      {
        ...search.repairOptions,
        cellCount: search.repairOptions.configuredCellCount ?? activeRepairSize(search)
      }
    ));
    if (repair) {
      changes = repair.changes;
      evaluation = repair.evaluation;
      recordStrategyStatistic(search, "repair", "evaluatedCandidates", repair.evaluatedCandidates);
      recordStrategyStatistic(search, "repair", repairMethodStatisticsKey(repair.method));
    }
  } else if (selectedStrategy === "lns" && search.lnsOptions.enabled) {
    recordStrategyStatistic(search, "lns", "attempts");
    const lns = timedStrategyProposal(search, "lns", () => proposeMonthSolverLns(
      search.context,
      search.source,
      search.random,
      {
        ...search.lnsOptions,
        destroySize: search.lnsOptions.configuredDestroySize ?? activeRepairSize(search)
      }
    ));
    if (lns) {
      recordStrategyStatistic(search, "lns", "evaluatedCandidates", lns.evaluatedCandidates);
      recordStrategyStatistic(search, "lns", repairMethodStatisticsKey(lns.method));
      recordStrategyStatistic(search, "lns", ["destroyMethods", lns.destroyMethod]);
      if (!lns.invariant.ok) {
        recordStrategyStatistic(search, "lns", "invariantRejections");
        return;
      }
      changes = lns.changes;
      evaluation = lns.evaluation;
    }
  }
  if (!changes) {
    strategy = "smallNeighbor";
    recordStrategyStatistic(search, "smallNeighbor", "attempts");
    changes = timedStrategyProposal(search, "smallNeighbor", () => (
      proposeMonthSolverNeighbor(search.plan, search.source, search.random)
    ));
  }
  if (!changes) return;
  search.generated += 1;
  recordStrategyStatistic(search, strategy, "generatedCandidates");
  if (!evaluation) {
    const evaluationStartedAt = nowMilliseconds();
    evaluation = evaluateMonthSolverChanges(search.context, changes);
    search.strategyTiming[strategy].totalMilliseconds += Math.max(
      0,
      nowMilliseconds() - evaluationStartedAt
    );
    if (evaluation) recordStrategyStatistic(search, strategy, "evaluatedCandidates");
  }
  if (!evaluation) return;
  search.proposed += 1;
  recordStrategyStatistic(search, strategy, "validCandidates");
  recordStrategyStatistic(search, strategy, "totalChangedCells", evaluation.changes.length);
  if (classifyEstimatedCandidate(evaluation.objective) === "feasible") {
    recordStrategyStatistic(search, strategy, "feasibleCandidates");
  }
  considerCandidate(search.archives, {
    plan: search.plan,
    changes: evaluation.changes,
    objective: evaluation.objective,
    dayMetrics: evaluation.dayMetrics
  });
  const decision = decideCandidateAcceptance({
    currentObjective: search.context.objective,
    candidateObjective: evaluation.objective,
    temperature: search.temperature,
    strategy,
    temperatureScaleByStrategy: search.temperatureScaleByStrategy,
    random: search.random
  });
  if (decision.reason === "statutoryRatchet") search.statutoryRatchetRejections += 1;
  if (!decision.accepted) return;
  const improvedCurrent = compareBestObjectives(evaluation.objective, search.context.objective) < 0;
  applyMonthSolverEvaluation(search.context, evaluation);
  search.accepted += 1;
  recordStrategyStatistic(search, strategy, "acceptedCandidates");
  if (improvedCurrent) recordStrategyStatistic(search, strategy, "currentImprovements");
  if (updateBest(search)) recordStrategyStatistic(search, strategy, "bestUpdates");
}

function restartSearchFromBest(search) {
  search.searchRestarts += 1;
  const seed = restartSeed(search.seed, search.searchRestarts);
  search.plan = clone(search.bestPlan);
  search.context = createMonthSolverScoreContext(search.plan);
  search.source = createMonthSolverNeighborSource(search.plan);
  search.random = createSeededRandom(`${seed}:search`);
  search.temperature = search.initialTemperature;
  search.strategyWeights = restartStrategyWeights(
    search.baseStrategyWeights,
    search.searchRestarts
  );
  search.stagnationBlocks = 0;
  search.restartIterations.push(search.performed);
  search.restartSeeds.push(seed);
  search.strategyWeightHistory.push({
    block: search.completedBlocks,
    reason: "restart",
    restart: search.searchRestarts,
    seed,
    temperature: search.temperature,
    weights: clone(search.strategyWeights)
  });
}

function completeBlock(search) {
  const blockBestUpdates = Object.values(search.blockStrategyStatistics)
    .reduce((sum, statistics) => sum + (Number(statistics.bestUpdates) || 0), 0);
  search.completedBlocks += 1;
  search.temperature = Math.max(search.minimumTemperature, search.temperature * search.coolingRate);
  search.stagnationBlocks = blockBestUpdates > 0 ? 0 : search.stagnationBlocks + 1;
  if (search.adaptiveStrategyEnabled) {
    const before = clone(search.strategyWeights);
    search.strategyWeights = adaptMonthSolverStrategyWeights(
      search.strategyWeights,
      search.blockStrategyStatistics
    );
    search.strategyWeightHistory.push({
      block: search.completedBlocks,
      reason: "adaptation",
      before,
      weights: clone(search.strategyWeights),
      rewards: Object.fromEntries(Object.entries(search.blockStrategyStatistics).map(([strategy, values]) => [
        strategy,
        strategyReward(values)
      ]))
    });
  }
  search.blockStrategyStatistics = createStrategyStatistics();
  if (search.restartEnabled
    && search.stagnationBlocks >= search.restartStagnationBlocks
    && search.performed < search.iterations) {
    restartSearchFromBest(search);
  }
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
    strategyWeights: clone(search.strategyWeights),
    stagnationBlocks: search.stagnationBlocks,
    searchRestarts: search.searchRestarts,
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
  const finalization = finalizeMonthSolverCandidates(search.archives, { masterSeed: search.seed });
  const selected = finalization.best ?? finalization.finalized[0] ?? {
    plan: search.bestPlan,
    objective: search.bestObjective,
    classification: "invalid",
    placementOk: false,
    finalBreaks: clone(search.bestPlan.breaks ?? {}),
    finalShortagePersonSlots: search.bestObjective.shortagePeople,
    finalAttributeShortagePersonSlots: 0,
    finalShortageByScope: { total: search.bestObjective.shortagePeople },
    estimateMetrics: null,
    shortageReports: shortageReports(search.bestPlan),
    unplacedSegments: [],
    placementStatistics: {}
  };
  const validation = validateMonthSolverPlan(selected.plan);
  if (!selected.placementOk) {
    validation.ok = false;
    validation.issues.push("休憩を完全配置できないため、この案は適用できません。");
  }
  return {
    plan: selected.plan,
    initialObjective: search.initialObjective,
    objective: selected.objective,
    classification: selected.classification,
    placementOk: selected.placementOk,
    finalBreaks: selected.finalBreaks,
    finalShortagePersonSlots: selected.finalShortagePersonSlots,
    finalAttributeShortagePersonSlots: selected.finalAttributeShortagePersonSlots,
    changedCellCount: selected.changedCellCount ?? 0,
    finalShortageByScope: selected.finalShortageByScope,
    estimateMetrics: selected.estimateMetrics,
    unplacedSegments: selected.unplacedSegments,
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
    strategyWeights: clone(search.strategyWeights),
    adaptiveStrategyEnabled: search.adaptiveStrategyEnabled,
    strategyWeightHistory: clone(search.strategyWeightHistory),
    stagnationBlocks: search.stagnationBlocks,
    searchRestarts: search.searchRestarts,
    restartIterations: [...search.restartIterations],
    restartSeeds: [...search.restartSeeds],
    performanceStatistics: {
      strategies: strategyTimingSnapshot(search)
    },
    stopped,
    timedOut,
    statistics: {
      completedBlocks: search.completedBlocks,
      generatedCandidates: search.generated,
      validCandidates: search.proposed,
      acceptedCandidates: search.accepted,
      statutoryRatchetRejections: search.statutoryRatchetRejections,
      strategies: summarizedStrategyStatistics(search.strategyStatistics),
      adaptiveStrategyEnabled: search.adaptiveStrategyEnabled,
      strategyWeightUpdates: search.strategyWeightHistory.length,
      stagnationBlocks: search.stagnationBlocks,
      searchRestarts: search.searchRestarts,
      ...finalization.statistics,
      placement: selected.placementStatistics
    },
    shortageReports: selected.shortageReports,
    validation
  };
}

function compareCompletedResults(first, second) {
  return compareFinalizedCandidates(
    { ...first, signature: "first" },
    { ...second, signature: "second" }
  );
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
  let totalSearchRestarts = 0;
  const totalStrategyStatistics = createStrategyStatistics();
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
    totalSearchRestarts += candidate.statistics?.searchRestarts ?? 0;
    addStrategyStatistics(totalStrategyStatistics, candidate.statistics?.strategies);
    if (!bestResult || compareCompletedResults(candidate, bestResult) < 0) {
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
    totalSearchRestarts = bestResult.statistics?.searchRestarts ?? 0;
    addStrategyStatistics(totalStrategyStatistics, bestResult.statistics?.strategies);
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
    searchRestarts: totalSearchRestarts,
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
      searchRestarts: totalSearchRestarts,
      strategies: summarizedStrategyStatistics(totalStrategyStatistics),
      restarts
    },
    stopped: manualStop,
    timedOut,
    optimalityGuaranteed: false
  };
}
