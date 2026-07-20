export const SOLVER_CONFIG_VERSION = 5;

export const SLOTS_PER_DAY = 96;
export const SLOT_MINUTES = 15;

export const DEFAULT_SOLVER_WEIGHTS = Object.freeze({
  statutoryHolidayDeficitDay: 100_000,
  restDeficit15Minutes: 250,
  consecutiveExcessSquared: 2_000,
  daysOffDeviationDay: Object.freeze({ deficit: 1_800, excess: 1_200 }),
  shortagePersonSlot: Object.freeze({
    total: 300,
    qualification: 300,
    department: 200,
    employmentType: 200
  }),
  overtimeExcess15Minutes: 50,
  missedDayOffRequest: 50,
  missedShiftRequest: 30,
  fairnessUnit: 10,
  changedCell: 1
});

export const DEFAULT_BREAK_CONSTRAINTS = Object.freeze({
  forbiddenStartMinutes: 60,
  forbiddenEndMinutes: 60,
  segmentWindowRadiusMinutes: 90,
  minSegmentGapMinutes: 60
});

export const TEMPERATURE_CALIBRATION = Object.freeze({
  sampleTargetCount: 30,
  candidateGenerationRange: Object.freeze([64, 128]),
  maxAttempts: 256,
  fallbackDeteriorationScore: 2_000,
  acceptProbabilityAtMedian: 0.30
});

function finiteNonNegative(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function expandWeight(value, keys, defaults) {
  if (Number.isFinite(Number(value))) {
    const scalar = finiteNonNegative(value, 0);
    return Object.fromEntries(keys.map((key) => [key, scalar]));
  }
  const candidate = value && typeof value === "object" ? value : {};
  return Object.fromEntries(keys.map((key) => [
    key,
    finiteNonNegative(candidate[key], defaults[key])
  ]));
}

export function normalizeSolverWeights(raw = {}) {
  const candidate = raw && typeof raw === "object" ? raw : {};
  return {
    statutoryHolidayDeficitDay: finiteNonNegative(
      candidate.statutoryHolidayDeficitDay,
      DEFAULT_SOLVER_WEIGHTS.statutoryHolidayDeficitDay
    ),
    restDeficit15Minutes: finiteNonNegative(
      candidate.restDeficit15Minutes,
      DEFAULT_SOLVER_WEIGHTS.restDeficit15Minutes
    ),
    consecutiveExcessSquared: finiteNonNegative(
      candidate.consecutiveExcessSquared,
      DEFAULT_SOLVER_WEIGHTS.consecutiveExcessSquared
    ),
    daysOffDeviationDay: expandWeight(
      candidate.daysOffDeviationDay,
      ["deficit", "excess"],
      DEFAULT_SOLVER_WEIGHTS.daysOffDeviationDay
    ),
    shortagePersonSlot: expandWeight(
      candidate.shortagePersonSlot,
      ["total", "qualification", "department", "employmentType"],
      DEFAULT_SOLVER_WEIGHTS.shortagePersonSlot
    ),
    overtimeExcess15Minutes: finiteNonNegative(
      candidate.overtimeExcess15Minutes,
      DEFAULT_SOLVER_WEIGHTS.overtimeExcess15Minutes
    ),
    missedDayOffRequest: finiteNonNegative(
      candidate.missedDayOffRequest,
      DEFAULT_SOLVER_WEIGHTS.missedDayOffRequest
    ),
    missedShiftRequest: finiteNonNegative(
      candidate.missedShiftRequest,
      DEFAULT_SOLVER_WEIGHTS.missedShiftRequest
    ),
    fairnessUnit: finiteNonNegative(candidate.fairnessUnit, DEFAULT_SOLVER_WEIGHTS.fairnessUnit),
    changedCell: finiteNonNegative(candidate.changedCell, DEFAULT_SOLVER_WEIGHTS.changedCell)
  };
}

export function normalizeBreakConstraints(raw = {}) {
  const candidate = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(Object.entries(DEFAULT_BREAK_CONSTRAINTS).map(([key, fallback]) => [
    key,
    finiteNonNegative(candidate[key], fallback)
  ]));
}
