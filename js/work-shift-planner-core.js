import { timeToMinutes } from "./date-time.js";
import { overtimeMinutesForShift } from "./shift-metrics.js";

export const MINIMUM_REST_MINUTES = 11 * 60;
export const COVERAGE_SLOT_MINUTES = 15;
export const COVERAGE_SLOT_COUNT = 24 * 60 / COVERAGE_SLOT_MINUTES;

export function validWorkShiftTypes(shiftTypes) {
  return (Array.isArray(shiftTypes) ? shiftTypes : []).filter((shiftType) => {
    if (!shiftType?.isWork) return false;
    const start = timeToMinutes(shiftType.start);
    const end = timeToMinutes(shiftType.end);
    return start !== null && end !== null && end > start;
  });
}

export function shiftSlotIndexes(shiftType) {
  const start = timeToMinutes(shiftType?.start);
  const end = timeToMinutes(shiftType?.end);
  if (start === null || end === null || end <= start) return [];
  const first = Math.floor(start / COVERAGE_SLOT_MINUTES);
  const last = Math.ceil(end / COVERAGE_SLOT_MINUTES);
  return Array.from({ length: Math.max(0, last - first) }, (_, index) => first + index)
    .filter((slot) => slot >= 0 && slot < COVERAGE_SLOT_COUNT);
}

export function restGapMinutes(previousShift, nextShift) {
  const previousEnd = timeToMinutes(previousShift?.end);
  const nextStart = timeToMinutes(nextShift?.start);
  if (previousEnd === null || nextStart === null) return null;
  return 1440 - previousEnd + nextStart;
}

export function hasShortRest(previousShift, nextShift, minimum = MINIMUM_REST_MINUTES) {
  const gap = restGapMinutes(previousShift, nextShift);
  return gap !== null && gap < minimum;
}

export function addShiftCoverage(coverage, shiftType, delta = 1) {
  for (const slot of shiftSlotIndexes(shiftType)) coverage[slot] += delta;
}

export function averageCoverage(coverage, shiftType) {
  const slots = shiftSlotIndexes(shiftType);
  if (!slots.length) return Number.POSITIVE_INFINITY;
  return slots.reduce((sum, slot) => sum + coverage[slot], 0) / slots.length;
}

export function dominantShiftCode(codes, candidateCodes) {
  const allowed = new Set(candidateCodes);
  const counts = new Map();
  for (const code of codes) {
    if (!allowed.has(code)) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))[0]?.[0] ?? "";
}

export function scoreShiftCandidate(candidate, context) {
  const coverageScore = averageCoverage(context.coverage, candidate) * 28;
  const dayConcentration = (context.dayShiftCounts.get(candidate.code) ?? 0) * 16;
  const employeeFrequency = (context.employeeShiftCounts.get(candidate.code) ?? 0) * 2;
  const preferredBonus = context.preferredShiftCode === candidate.code ? -120 : 0;
  const tendencyBonus = !context.preferredShiftCode && context.dominantShiftCode === candidate.code ? -50 : 0;
  const continuityBonus = context.previousShift?.code === candidate.code
    ? -12
    : context.nextShift?.code === candidate.code
      ? -8
      : 0;

  const candidateOvertime = overtimeMinutesForShift(candidate);
  const projectedOvertime = context.currentOvertimeMinutes + candidateOvertime;
  const excess = Math.max(0, projectedOvertime - context.fixedOvertimeMinutes);
  const overtimeScore = candidateOvertime * 0.04 + excess * 0.5;

  // 11時間休息は月間ソルバーのハード制約なので、個人の遅早回避設定にかかわらず
  // 初期案の段階から全員へ同じ強いペナルティを適用する。
  const previousShortRest = hasShortRest(context.previousShift, candidate);
  const nextShortRest = hasShortRest(candidate, context.nextShift);
  const restPenalty = (previousShortRest ? 10000 : 0) + (nextShortRest ? 10000 : 0);

  return {
    score: coverageScore
      + dayConcentration
      + employeeFrequency
      + preferredBonus
      + tendencyBonus
      + continuityBonus
      + overtimeScore
      + restPenalty,
    previousShortRest,
    nextShortRest,
    projectedOvertime
  };
}

export function chooseBestShift(candidates, context) {
  return candidates
    .map((candidate) => ({ candidate, ...scoreShiftCandidate(candidate, context) }))
    .sort((a, b) =>
      a.score - b.score
      || timeToMinutes(a.candidate.start) - timeToMinutes(b.candidate.start)
      || a.candidate.code.localeCompare(b.candidate.code, "ja")
    )[0] ?? null;
}
