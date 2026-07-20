import { hashSeed } from "./month-solver-rng.js";

export const EPOCH_ITERATIONS = 2_000;
export const YIELD_CHUNK_ITERATIONS = 120;
export const FALLBACK_DETERIORATION_SCORE = 2_000;
export const TEMPERATURE_ACCEPT_PROBABILITY = 0.30;
export const TEMPERATURE_SAMPLE_MIN = 64;
export const TEMPERATURE_SAMPLE_MAX = 128;
export const TEMPERATURE_SAMPLE_DEFAULT = 96;
export const TEMPERATURE_SAMPLE_REQUIRED_POSITIVE = 30;

export const DEFAULT_TEMPERATURE_SCALE_BY_STRATEGY = Object.freeze({
  smallNeighbor: 1,
  repair: 1,
  lns: 1
});

function finiteNonNegative(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function statutoryVector(objective) {
  const fallback = finiteNonNegative(objective?.hard, 0);
  return [
    finiteNonNegative(objective?.statutoryViolationCount, fallback),
    finiteNonNegative(objective?.statutoryViolationAmount, fallback)
  ];
}

export function compareStatutoryVectors(first, second) {
  const left = Array.isArray(first) ? first : statutoryVector(first);
  const right = Array.isArray(second) ? second : statutoryVector(second);
  for (let index = 0; index < 2; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

export function temperatureFromPositiveDeltas(positiveDeltas) {
  const values = (Array.isArray(positiveDeltas) ? positiveDeltas : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  const fallbackUsed = values.length < TEMPERATURE_SAMPLE_REQUIRED_POSITIVE;
  const deterioration = fallbackUsed
    ? FALLBACK_DETERIORATION_SCORE
    : values[Math.floor(values.length / 2)];
  return {
    temperature: deterioration / -Math.log(TEMPERATURE_ACCEPT_PROBABILITY),
    medianPositiveDelta: fallbackUsed ? null : deterioration,
    positiveDeltaCount: values.length,
    fallbackUsed
  };
}

export function normalizeTemperatureScales(value = {}) {
  const candidate = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_TEMPERATURE_SCALE_BY_STRATEGY).map(([key, fallback]) => [
    key,
    Math.max(0.000001, finiteNonNegative(candidate[key], fallback))
  ]));
}

export function effectiveTemperature(temperature, strategy, scales = DEFAULT_TEMPERATURE_SCALE_BY_STRATEGY) {
  const normalized = normalizeTemperatureScales(scales);
  return Math.max(0.000001, Number(temperature) || 0) * (normalized[strategy] ?? 1);
}

export function decideCandidateAcceptance(options) {
  const currentObjective = options.currentObjective;
  const candidateObjective = options.candidateObjective;
  if (!candidateObjective || compareStatutoryVectors(candidateObjective, currentObjective) > 0) {
    return { accepted: false, reason: "statutoryRatchet", probability: 0 };
  }
  const delta = Number(candidateObjective.scalar) - Number(currentObjective.scalar);
  if (!Number.isFinite(delta)) return { accepted: false, reason: "invalidScore", probability: 0 };
  if (delta <= 0) return { accepted: true, reason: "improved", probability: 1 };
  const temperature = effectiveTemperature(
    options.temperature,
    options.strategy ?? "smallNeighbor",
    options.temperatureScaleByStrategy
  );
  const probability = Math.exp(-delta / temperature);
  const draw = typeof options.random === "function" ? options.random() : 1;
  return {
    accepted: draw < probability,
    reason: draw < probability ? "annealing" : "annealingRejected",
    probability
  };
}

export function restartSeed(masterSeed, restartNumber) {
  const normalizedRestart = Math.max(1, Math.floor(Number(restartNumber) || 1));
  return hashSeed(`${String(masterSeed ?? 1)}:restart:${normalizedRestart}`);
}

export function normalizeExecutionConfig(config = {}) {
  const fixedBlockCount = config.fixedBlockCount !== null
    && config.fixedBlockCount !== undefined
    && config.fixedBlockCount !== ""
    && Number.isFinite(Number(config.fixedBlockCount))
    ? Math.max(1, Math.floor(Number(config.fixedBlockCount)))
    : null;
  const configuredIterations = Math.max(1, Math.floor(Number(config.iterations ?? 8_000) || 8_000));
  const iterations = fixedBlockCount === null
    ? configuredIterations
    : fixedBlockCount * EPOCH_ITERATIONS;
  return {
    iterations,
    fixedBlockCount,
    plannedBlocks: Math.ceil(iterations / EPOCH_ITERATIONS),
    yieldChunkIterations: Math.max(
      1,
      Math.floor(Number(config.yieldChunkIterations ?? config.chunkSize ?? YIELD_CHUNK_ITERATIONS)
        || YIELD_CHUNK_ITERATIONS)
    ),
    timeBudgetMs: config.timeBudgetMs !== null
      && config.timeBudgetMs !== undefined
      && config.timeBudgetMs !== ""
      && Number.isFinite(Number(config.timeBudgetMs))
      ? Math.max(0, Math.floor(Number(config.timeBudgetMs)))
      : null
  };
}
