import {
  DEFAULT_BREAK_CONSTRAINTS,
  SLOT_MINUTES,
  normalizeBreakConstraints
} from "./solver-config.js";

const DEFAULT_MAX_CANDIDATES = 5_000;

function parseMinute(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60
    ? hour * 60 + minute
    : null;
}

function alignedCeil(minutes) {
  return Math.ceil(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

function alignedFloor(minutes) {
  return Math.floor(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

function shiftBounds(shiftType) {
  const startMinutes = parseMinute(shiftType?.startMinutes ?? shiftType?.start);
  const endMinutes = parseMinute(shiftType?.endMinutes ?? shiftType?.end);
  return { startMinutes, endMinutes };
}

function isDayOff(shiftType) {
  return Boolean(shiftType?.isDayOff ?? shiftType?.isWork === false);
}

function normalizedFixedBreaks(fixedBreaks) {
  return (Array.isArray(fixedBreaks) ? fixedBreaks : [])
    .map((item) => ({
      type: item?.type,
      label: item?.label,
      startMinute: parseMinute(item?.startMinute ?? item?.start),
      endMinute: parseMinute(item?.endMinute ?? item?.end)
    }))
    .filter((item) => item.startMinute !== null && item.endMinute !== null && item.endMinute > item.startMinute)
    .sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
}

export function enumerateSegmentStartsSimple(shiftType, segment, breakConstraints = {}) {
  if (!shiftType || isDayOff(shiftType) || !segment) return [];
  const { startMinutes, endMinutes } = shiftBounds(shiftType);
  const duration = Number(segment.duration);
  const targetOffset = Number(segment.targetOffset);
  if (
    !Number.isFinite(startMinutes)
    || !Number.isFinite(endMinutes)
    || endMinutes <= startMinutes
    || !Number.isFinite(duration)
    || duration <= 0
    || duration % SLOT_MINUTES !== 0
    || !Number.isFinite(targetOffset)
  ) return [];

  const constraints = normalizeBreakConstraints({ ...DEFAULT_BREAK_CONSTRAINTS, ...breakConstraints });
  const earliest = alignedCeil(startMinutes + constraints.forbiddenStartMinutes);
  const latestEnd = alignedFloor(endMinutes - constraints.forbiddenEndMinutes);
  const target = startMinutes + targetOffset;
  const windowStart = alignedCeil(Math.max(
    earliest,
    target - constraints.segmentWindowRadiusMinutes
  ));
  const windowEnd = alignedFloor(Math.min(
    latestEnd - duration,
    target + constraints.segmentWindowRadiusMinutes
  ));
  if (windowStart > windowEnd) return [];

  const starts = [];
  for (let start = windowStart; start <= windowEnd; start += SLOT_MINUTES) starts.push(start);
  return starts;
}

function toPlacement(segment, index, startMinute, shiftStart) {
  return {
    index,
    type: segment.type,
    ...(segment.label ? { label: segment.label } : {}),
    duration: Number(segment.duration),
    startMinute,
    endMinute: startMinute + Number(segment.duration),
    targetMinute: shiftStart + Number(segment.targetOffset)
  };
}

function candidateDeviation(candidate) {
  return candidate.reduce((sum, item) => sum + Math.abs(item.startMinute - item.targetMinute), 0);
}

function compareCandidates(left, right) {
  const deviation = candidateDeviation(left) - candidateDeviation(right);
  if (deviation !== 0) return deviation;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = left[index].startMinute - right[index].startMinute;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function fixedCandidate(shiftType, segments, fixedBreaks, breakConstraints) {
  const fixed = normalizedFixedBreaks(fixedBreaks);
  if (fixed.length !== segments.length) return null;
  const { startMinutes } = shiftBounds(shiftType);
  const constraints = normalizeBreakConstraints({ ...DEFAULT_BREAK_CONSTRAINTS, ...breakConstraints });
  const candidate = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const item = fixed[index];
    const duration = item.endMinute - item.startMinute;
    if (duration !== Number(segment.duration)) return null;
    if (item.type && segment.type && item.type !== segment.type) return null;
    if (!enumerateSegmentStartsSimple(shiftType, segment, constraints).includes(item.startMinute)) return null;
    if (index > 0 && item.startMinute < candidate[index - 1].endMinute + constraints.minSegmentGapMinutes) return null;
    candidate.push({
      ...toPlacement(segment, index, item.startMinute, startMinutes),
      ...(item.label ? { label: item.label } : {})
    });
  }
  return candidate;
}

/**
 * 休憩方針の全セグメントを満たす配置候補を、決定的な順序で列挙する。
 * 返り値の各要素は、その従業員の全休憩セグメントを含む完全配置である。
 */
export function enumerateBreakPlacementCandidates(
  shiftType,
  breakPolicy = shiftType?.breakPolicy,
  fixedBreaks = [],
  breakConstraints = shiftType?.breakConstraints ?? {},
  options = {}
) {
  if (!shiftType || isDayOff(shiftType)) return [[]];
  const { startMinutes, endMinutes } = shiftBounds(shiftType);
  const segments = Array.isArray(breakPolicy?.segments) ? breakPolicy.segments : [];
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) return [];
  if (segments.length === 0) {
    return Number(breakPolicy?.totalMinutes) === 0 && (fixedBreaks?.length ?? 0) === 0 ? [[]] : [];
  }

  const constraints = normalizeBreakConstraints({ ...DEFAULT_BREAK_CONSTRAINTS, ...breakConstraints });
  if ((Array.isArray(fixedBreaks) ? fixedBreaks : []).length > 0) {
    const fixed = fixedCandidate(shiftType, segments, fixedBreaks, constraints);
    return fixed ? [fixed] : [];
  }

  const startsBySegment = segments.map((segment) => {
    const target = startMinutes + Number(segment.targetOffset);
    return enumerateSegmentStartsSimple(shiftType, segment, constraints)
      .sort((left, right) => Math.abs(left - target) - Math.abs(right - target) || left - right);
  });
  if (startsBySegment.some((starts) => starts.length === 0)) return [];

  const maxCandidates = Math.max(1, Number(options.maxCandidates) || DEFAULT_MAX_CANDIDATES);
  const candidates = [];
  const current = [];
  function visit(index) {
    if (candidates.length >= maxCandidates) return;
    if (index === segments.length) {
      candidates.push(current.map((item) => ({ ...item })));
      return;
    }
    const segment = segments[index];
    const minimumStart = index === 0
      ? Number.NEGATIVE_INFINITY
      : current[index - 1].endMinute + constraints.minSegmentGapMinutes;
    for (const startMinute of startsBySegment[index]) {
      if (startMinute < minimumStart) continue;
      current.push(toPlacement(segment, index, startMinute, startMinutes));
      visit(index + 1);
      current.pop();
      if (candidates.length >= maxCandidates) break;
    }
  }
  visit(0);
  return candidates.sort(compareCandidates);
}
