import { enumerateBreakPlacementCandidates } from "./break-placement-candidates.js";
import { SLOT_MINUTES, SLOTS_PER_DAY } from "./solver-config.js";

const LOCAL_IMPROVEMENT_SWEEPS = 4;
const PAIR_CANDIDATE_LIMIT = 24;

function asMap(value, key = "id") {
  if (value instanceof Map) return value;
  if (Array.isArray(value)) return new Map(value.map((item) => [item?.[key], item]));
  return new Map(Object.entries(value && typeof value === "object" ? value : {}));
}

function employeeId(assignment) {
  return String(assignment?.employeeId ?? assignment?.id ?? assignment?.employee?.id ?? "");
}

function assignmentOrder(assignment, fallback) {
  const value = Number(assignment?.displayOrder ?? assignment?.order ?? assignment?.employee?.order);
  return Number.isFinite(value) ? value : fallback;
}

function shiftFor(assignment) {
  return assignment?.shiftType ?? assignment?.shift ?? {
    code: assignment?.shiftCode,
    isDayOff: false,
    startMinutes: assignment?.shiftStart,
    endMinutes: assignment?.shiftEnd
  };
}

function shiftCode(assignment, shiftType) {
  return assignment?.shiftCode ?? shiftType?.code ?? "";
}

function policyFor(assignment, shiftType, breakPolicies) {
  if (assignment?.breakPolicy) return assignment.breakPolicy;
  const code = shiftCode(assignment, shiftType);
  return asMap(breakPolicies, "code").get(code) ?? shiftType?.breakPolicy;
}

function fixedFor(fixedBreaks, id) {
  if (fixedBreaks instanceof Map) return fixedBreaks.get(id) ?? [];
  if (Array.isArray(fixedBreaks)) return fixedBreaks.filter((item) => String(item?.employeeId ?? item?.id) === id);
  return fixedBreaks?.[id] ?? [];
}

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

function bounds(shiftType) {
  return {
    start: parseMinute(shiftType?.startMinutes ?? shiftType?.start),
    end: parseMinute(shiftType?.endMinutes ?? shiftType?.end)
  };
}

function scopeKey(scope) {
  const type = scope?.type ?? "total";
  return type === "total" ? "total" : `${type}:${String(scope?.key ?? "")}`;
}

function attributeValues(assignment) {
  const employee = assignment?.employee ?? assignment;
  return {
    employmentType: employee?.employmentType ? [String(employee.employmentType)] : [],
    department: employee?.department ? [String(employee.department)] : [],
    qualification: (employee?.qualifications ?? []).map(String)
  };
}

function ensureArray(target, key) {
  target[key] ??= new Float64Array(SLOTS_PER_DAY);
  return target[key];
}

function createCoverageState(assignments) {
  const raw = {
    total: new Float64Array(SLOTS_PER_DAY),
    byEmploymentType: {},
    byDepartment: {},
    byQualification: {}
  };
  const load = {
    total: new Float64Array(SLOTS_PER_DAY),
    byEmploymentType: {},
    byDepartment: {},
    byQualification: {}
  };
  for (const assignment of assignments) {
    const { start, end } = bounds(assignment.shiftType);
    if (start === null || end === null || end <= start || assignment.shiftType?.isDayOff) continue;
    const attributes = attributeValues(assignment.source);
    for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
      const minute = slot * SLOT_MINUTES;
      if (minute < start || minute >= end) continue;
      raw.total[slot] += 1;
      for (const key of attributes.employmentType) ensureArray(raw.byEmploymentType, key)[slot] += 1;
      for (const key of attributes.department) ensureArray(raw.byDepartment, key)[slot] += 1;
      for (const key of attributes.qualification) ensureArray(raw.byQualification, key)[slot] += 1;
    }
  }
  return { raw, load };
}

function slotRange(item) {
  const first = Math.max(0, Math.floor(item.startMinute / SLOT_MINUTES));
  const last = Math.min(SLOTS_PER_DAY, Math.ceil(item.endMinute / SLOT_MINUTES));
  return { first, last };
}

function applyCandidateLoad(coverage, assignment, candidate, delta) {
  const attributes = attributeValues(assignment.source);
  for (const item of candidate ?? []) {
    const { first, last } = slotRange(item);
    for (let slot = first; slot < last; slot += 1) {
      coverage.load.total[slot] += delta;
      for (const key of attributes.employmentType) ensureArray(coverage.load.byEmploymentType, key)[slot] += delta;
      for (const key of attributes.department) ensureArray(coverage.load.byDepartment, key)[slot] += delta;
      for (const key of attributes.qualification) ensureArray(coverage.load.byQualification, key)[slot] += delta;
    }
  }
}

function scopeArrays(coverage, scope) {
  switch (scope?.type ?? "total") {
    case "employmentType": return [
      coverage.raw.byEmploymentType[String(scope.key)] ?? new Float64Array(SLOTS_PER_DAY),
      coverage.load.byEmploymentType[String(scope.key)] ?? new Float64Array(SLOTS_PER_DAY)
    ];
    case "department": return [
      coverage.raw.byDepartment[String(scope.key)] ?? new Float64Array(SLOTS_PER_DAY),
      coverage.load.byDepartment[String(scope.key)] ?? new Float64Array(SLOTS_PER_DAY)
    ];
    case "qualification": return [
      coverage.raw.byQualification[String(scope.key)] ?? new Float64Array(SLOTS_PER_DAY),
      coverage.load.byQualification[String(scope.key)] ?? new Float64Array(SLOTS_PER_DAY)
    ];
    default: return [coverage.raw.total, coverage.load.total];
  }
}

function candidateSpacingPenalty(candidate) {
  if ((candidate?.length ?? 0) < 3) return 0;
  const gaps = [];
  for (let index = 1; index < candidate.length; index += 1) {
    gaps.push(candidate[index].startMinute - candidate[index - 1].endMinute);
  }
  const average = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  return gaps.reduce((sum, value) => sum + Math.abs(value - average), 0);
}

function candidateTargetDeviation(candidate) {
  return (candidate ?? []).reduce(
    (sum, item) => sum + Math.abs(item.startMinute - item.targetMinute),
    0
  );
}

function evaluateState(coverage, requirements, selected) {
  let totalShortage = 0;
  let attributeShortage = 0;
  const shortageByScope = {};
  for (const requirement of requirements) {
    const [raw, load] = scopeArrays(coverage, requirement.scope);
    const startSlot = Math.max(0, Math.min(SLOTS_PER_DAY, Math.floor(Number(requirement.startSlot) || 0)));
    const endSlot = Math.max(startSlot, Math.min(SLOTS_PER_DAY, Math.floor(Number(requirement.endSlot) || 0)));
    const required = Math.max(0, Number(requirement.count) || 0);
    let shortage = 0;
    for (let slot = startSlot; slot < endSlot; slot += 1) {
      shortage += Math.max(0, required - (raw[slot] - load[slot]));
    }
    const key = scopeKey(requirement.scope);
    shortageByScope[key] = (shortageByScope[key] ?? 0) + shortage;
    if (key === "total") totalShortage += shortage;
    else attributeShortage += shortage;
  }

  let minimumCoverage = Number.POSITIVE_INFINITY;
  let concurrentPenalty = 0;
  for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
    if (coverage.raw.total[slot] > 0) {
      minimumCoverage = Math.min(minimumCoverage, coverage.raw.total[slot] - coverage.load.total[slot]);
    }
    concurrentPenalty += coverage.load.total[slot] ** 2;
  }
  if (!Number.isFinite(minimumCoverage)) minimumCoverage = 0;

  let spacingPenalty = 0;
  let targetDeviation = 0;
  for (const candidate of selected.values()) {
    spacingPenalty += candidateSpacingPenalty(candidate);
    targetDeviation += candidateTargetDeviation(candidate);
  }
  return {
    vector: [
      totalShortage,
      attributeShortage,
      -minimumCoverage,
      concurrentPenalty,
      spacingPenalty,
      targetDeviation
    ],
    totalShortage,
    attributeShortage,
    shortageByScope,
    minimumCoverage
  };
}

function isBetter(left, right) {
  if (!right) return true;
  for (let index = 0; index < left.vector.length; index += 1) {
    const difference = left.vector[index] - right.vector[index];
    if (Math.abs(difference) > 1e-9) return difference < 0;
  }
  return false;
}

function finalCoverage(coverage) {
  const subtract = (raw, load) => Float64Array.from(raw, (value, index) => value - (load[index] ?? 0));
  const mapGroup = (rawGroup, loadGroup) => Object.fromEntries(
    [...new Set([...Object.keys(rawGroup), ...Object.keys(loadGroup)])]
      .sort((left, right) => left.localeCompare(right, "ja"))
      .map((key) => [key, subtract(rawGroup[key] ?? new Float64Array(SLOTS_PER_DAY), loadGroup[key] ?? [])])
  );
  return {
    total: subtract(coverage.raw.total, coverage.load.total),
    byEmploymentType: mapGroup(coverage.raw.byEmploymentType, coverage.load.byEmploymentType),
    byDepartment: mapGroup(coverage.raw.byDepartment, coverage.load.byDepartment),
    byQualification: mapGroup(coverage.raw.byQualification, coverage.load.byQualification)
  };
}

/**
 * 日単位で全従業員の休憩を配置する純粋関数。
 */
export function placeBreaksForDay(input = {}) {
  const breakPolicies = asMap(input.breakPolicies ?? {}, "code");
  const assignments = (Array.isArray(input.assignments) ? input.assignments : [])
    .map((source, index) => {
      const shiftType = shiftFor(source);
      return {
        id: employeeId(source),
        order: assignmentOrder(source, index),
        source,
        shiftType,
        breakPolicy: policyFor(source, shiftType, breakPolicies),
        fixedBreaks: fixedFor(input.fixedBreaks, employeeId(source))
      };
    })
    .filter((assignment) => assignment.id && !assignment.shiftType?.isDayOff)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, "ja"));

  const requirements = Array.isArray(input.coverageRequirements) ? input.coverageRequirements : [];
  const coverage = createCoverageState(assignments);
  const selected = new Map();
  const candidatesByEmployee = new Map();
  const fixedIds = new Set();
  const unplacedSegments = [];
  let generatedCandidates = 0;

  for (const assignment of assignments) {
    const policy = assignment.breakPolicy ?? { totalMinutes: 0, segments: [] };
    const candidates = enumerateBreakPlacementCandidates(
      assignment.shiftType,
      policy,
      assignment.fixedBreaks,
      input.breakConstraints ?? assignment.shiftType?.breakConstraints ?? {},
      { maxCandidates: input.maxCandidatesPerAssignment }
    );
    generatedCandidates += candidates.length;
    if (candidates.length === 0) {
      for (const [index, segment] of (policy.segments ?? []).entries()) {
        unplacedSegments.push({
          employeeId: assignment.id,
          segmentIndex: index,
          type: segment.type,
          duration: segment.duration,
          reason: assignment.fixedBreaks.length ? "fixedBreakConflict" : "noCompletePlacement"
        });
      }
      selected.set(assignment.id, []);
      continue;
    }
    candidatesByEmployee.set(assignment.id, candidates);
    if (assignment.fixedBreaks.length) {
      fixedIds.add(assignment.id);
      selected.set(assignment.id, candidates[0]);
      applyCandidateLoad(coverage, assignment, candidates[0], 1);
    }
  }

  const movable = assignments.filter((assignment) => candidatesByEmployee.has(assignment.id) && !fixedIds.has(assignment.id));
  for (const assignment of movable) {
    let bestCandidate = null;
    let bestScore = null;
    for (const candidate of candidatesByEmployee.get(assignment.id)) {
      selected.set(assignment.id, candidate);
      applyCandidateLoad(coverage, assignment, candidate, 1);
      const score = evaluateState(coverage, requirements, selected);
      applyCandidateLoad(coverage, assignment, candidate, -1);
      selected.delete(assignment.id);
      if (isBetter(score, bestScore)) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }
    selected.set(assignment.id, bestCandidate ?? []);
    applyCandidateLoad(coverage, assignment, bestCandidate, 1);
  }

  let improvementMoves = 0;
  const localImprovementSweeps = Math.max(
    0,
    Number.isFinite(Number(input.localImprovementSweeps))
      ? Number(input.localImprovementSweeps)
      : LOCAL_IMPROVEMENT_SWEEPS
  );
  for (let sweep = 0; sweep < localImprovementSweeps; sweep += 1) {
    let improved = false;
    for (const assignment of movable) {
      const current = selected.get(assignment.id) ?? [];
      applyCandidateLoad(coverage, assignment, current, -1);
      selected.delete(assignment.id);
      let bestCandidate = current;
      applyCandidateLoad(coverage, assignment, current, 1);
      selected.set(assignment.id, current);
      let bestScore = evaluateState(coverage, requirements, selected);
      applyCandidateLoad(coverage, assignment, current, -1);
      selected.delete(assignment.id);
      for (const candidate of candidatesByEmployee.get(assignment.id)) {
        applyCandidateLoad(coverage, assignment, candidate, 1);
        selected.set(assignment.id, candidate);
        const score = evaluateState(coverage, requirements, selected);
        applyCandidateLoad(coverage, assignment, candidate, -1);
        selected.delete(assignment.id);
        if (isBetter(score, bestScore)) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }
      selected.set(assignment.id, bestCandidate);
      applyCandidateLoad(coverage, assignment, bestCandidate, 1);
      if (bestCandidate !== current) {
        improved = true;
        improvementMoves += 1;
      }
    }
    if (!improved) break;
  }

  let pairImprovementMoves = 0;
  if (input.enablePairImprovement !== false) {
    for (let leftIndex = 0; leftIndex < movable.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < movable.length; rightIndex += 1) {
        const left = movable[leftIndex];
        const right = movable[rightIndex];
        const currentLeft = selected.get(left.id) ?? [];
        const currentRight = selected.get(right.id) ?? [];
        applyCandidateLoad(coverage, left, currentLeft, -1);
        applyCandidateLoad(coverage, right, currentRight, -1);
        selected.delete(left.id);
        selected.delete(right.id);
        let bestLeft = currentLeft;
        let bestRight = currentRight;
        applyCandidateLoad(coverage, left, currentLeft, 1);
        applyCandidateLoad(coverage, right, currentRight, 1);
        selected.set(left.id, currentLeft);
        selected.set(right.id, currentRight);
        let bestScore = evaluateState(coverage, requirements, selected);
        applyCandidateLoad(coverage, left, currentLeft, -1);
        applyCandidateLoad(coverage, right, currentRight, -1);
        selected.delete(left.id);
        selected.delete(right.id);
        const leftCandidates = candidatesByEmployee.get(left.id).slice(0, PAIR_CANDIDATE_LIMIT);
        const rightCandidates = candidatesByEmployee.get(right.id).slice(0, PAIR_CANDIDATE_LIMIT);
        for (const leftCandidate of leftCandidates) {
          applyCandidateLoad(coverage, left, leftCandidate, 1);
          selected.set(left.id, leftCandidate);
          for (const rightCandidate of rightCandidates) {
            applyCandidateLoad(coverage, right, rightCandidate, 1);
            selected.set(right.id, rightCandidate);
            const score = evaluateState(coverage, requirements, selected);
            applyCandidateLoad(coverage, right, rightCandidate, -1);
            selected.delete(right.id);
            if (isBetter(score, bestScore)) {
              bestScore = score;
              bestLeft = leftCandidate;
              bestRight = rightCandidate;
            }
          }
          applyCandidateLoad(coverage, left, leftCandidate, -1);
          selected.delete(left.id);
        }
        selected.set(left.id, bestLeft);
        selected.set(right.id, bestRight);
        applyCandidateLoad(coverage, left, bestLeft, 1);
        applyCandidateLoad(coverage, right, bestRight, 1);
        if (bestLeft !== currentLeft || bestRight !== currentRight) pairImprovementMoves += 1;
      }
    }
  }

  const finalScore = evaluateState(coverage, requirements, selected);
  const placements = Object.fromEntries(assignments.map((assignment) => [
    assignment.id,
    (selected.get(assignment.id) ?? []).map(({ targetMinute, index, duration, ...item }) => ({ ...item }))
  ]));
  return {
    ok: unplacedSegments.length === 0,
    placements,
    unplacedSegments,
    finalCoverage: finalCoverage(coverage),
    finalShortagePersonSlots: finalScore.totalShortage,
    finalShortageByScope: finalScore.shortageByScope,
    statistics: {
      seed: input.seed ?? null,
      assignmentCount: assignments.length,
      movableAssignmentCount: movable.length,
      fixedAssignmentCount: fixedIds.size,
      generatedCandidates,
      improvementMoves,
      pairImprovementMoves,
      minimumCoverage: finalScore.minimumCoverage
    }
  };
}
