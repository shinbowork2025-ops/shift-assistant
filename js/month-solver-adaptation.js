import { normalizeMonthSolverStrategyWeights } from "./month-solver-lns.js";

export const ADAPTIVE_STRATEGY_MIN_BLOCKS = 50;
export const MINIMUM_STRATEGY_SELECTION_RATE = 0.05;
export const SHORT_STAGNATION_BLOCKS = 2;
export const LONG_STAGNATION_BLOCKS = 5;
export const FURTHER_STAGNATION_BLOCKS = 9;
export const RESTART_STAGNATION_BLOCKS = 10;

const STRATEGIES = Object.freeze(["smallNeighbor", "repair", "lns"]);

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

export function adaptiveStrategyEnabled(plannedBlocks, configured) {
  if (configured === true) return true;
  if (configured === false) return false;
  return Number(plannedBlocks) >= ADAPTIVE_STRATEGY_MIN_BLOCKS;
}

export function enforceMinimumStrategyRates(weights, minimum = MINIMUM_STRATEGY_SELECTION_RATE) {
  const normalized = normalizeMonthSolverStrategyWeights(weights);
  const active = STRATEGIES.filter((strategy) => Number(weights?.[strategy]) > 0);
  if (!active.length) return { smallNeighbor: 1, repair: 0, lns: 0 };
  const floor = Math.max(0, Math.min(Number(minimum) || 0, 1 / active.length));
  const residual = 1 - floor * active.length;
  const activeTotal = active.reduce((sum, strategy) => sum + normalized[strategy], 0);
  return Object.fromEntries(STRATEGIES.map((strategy) => [
    strategy,
    active.includes(strategy)
      ? floor + residual * (activeTotal > 0 ? normalized[strategy] / activeTotal : 1 / active.length)
      : 0
  ]));
}

export function strategyReward(statistics = {}) {
  const attempts = Number(statistics.attempts) || 0;
  const valid = Number(statistics.validCandidates) || 0;
  const accepted = Number(statistics.acceptedCandidates) || 0;
  return 1
    + ratio(valid, attempts)
    + ratio(accepted, valid)
    + 2 * ratio(Number(statistics.currentImprovements) || 0, valid)
    + 4 * ratio(Number(statistics.bestUpdates) || 0, valid)
    + 2 * ratio(Number(statistics.feasibleCandidates) || 0, valid);
}

export function adaptMonthSolverStrategyWeights(currentWeights, blockStatistics, options = {}) {
  const smoothing = Math.max(0, Math.min(1, Number(options.smoothing ?? 0.5) || 0.5));
  const rewards = Object.fromEntries(STRATEGIES.map((strategy) => [
    strategy,
    Number(currentWeights?.[strategy]) > 0 ? strategyReward(blockStatistics?.[strategy]) : 0
  ]));
  const rewardWeights = normalizeMonthSolverStrategyWeights(rewards);
  const blended = Object.fromEntries(STRATEGIES.map((strategy) => [
    strategy,
    Number(currentWeights?.[strategy]) > 0
      ? (1 - smoothing) * (Number(currentWeights[strategy]) || 0) + smoothing * rewardWeights[strategy]
      : 0
  ]));
  return enforceMinimumStrategyRates(
    blended,
    options.minimumSelectionRate ?? MINIMUM_STRATEGY_SELECTION_RATE
  );
}

export function stagnationStage(stagnantBlocks, restartThreshold = RESTART_STAGNATION_BLOCKS) {
  const blocks = Math.max(0, Math.floor(Number(stagnantBlocks) || 0));
  const restartAt = Math.max(1, Math.floor(Number(restartThreshold) || RESTART_STAGNATION_BLOCKS));
  const furtherAt = Math.max(
    LONG_STAGNATION_BLOCKS + 1,
    restartAt === RESTART_STAGNATION_BLOCKS ? FURTHER_STAGNATION_BLOCKS : restartAt - 1
  );
  if (blocks >= furtherAt) return "further";
  if (blocks >= LONG_STAGNATION_BLOCKS) return "long";
  if (blocks >= SHORT_STAGNATION_BLOCKS) return "short";
  return "improving";
}

export function repairSizeForStagnation(stagnantBlocks, blockNumber = 0, restartThreshold) {
  const ranges = {
    improving: [3, 5],
    short: [6, 8],
    long: [9, 12],
    further: [13, 16]
  };
  const [minimum, maximum] = ranges[stagnationStage(stagnantBlocks, restartThreshold)];
  const offset = Math.abs(Math.floor(Number(blockNumber) || 0)) % (maximum - minimum + 1);
  return minimum + offset;
}

export function restartStrategyWeights(baseWeights, restartNumber) {
  const number = Math.max(1, Math.floor(Number(restartNumber) || 1));
  const phases = [
    { smallNeighbor: 0.90, repair: 1.10, lns: 1.25 },
    { smallNeighbor: 0.85, repair: 1.25, lns: 1.10 },
    { smallNeighbor: 1.10, repair: 0.95, lns: 1.20 }
  ];
  const phase = phases[(number - 1) % phases.length];
  const tilted = Object.fromEntries(STRATEGIES.map((strategy) => [
    strategy,
    (Number(baseWeights?.[strategy]) || 0) * phase[strategy]
  ]));
  return enforceMinimumStrategyRates(tilted);
}
