import { plannedBreakTemplates } from "../break-rules.js";
import { timeToMinutes } from "../date-time.js";
import { validateBreakPolicyForShift } from "./break-policy.js";
import { DEFAULT_BREAK_CONSTRAINTS } from "./solver-config.js";

export function toSolverShiftType(shiftType) {
  const isDayOff = Boolean(shiftType?.isDayOff ?? shiftType?.isWork === false);
  return {
    ...shiftType,
    isDayOff,
    startMinutes: isDayOff ? undefined : timeToMinutes(shiftType?.start),
    endMinutes: isDayOff ? undefined : timeToMinutes(shiftType?.end)
  };
}

export function createDefaultBreakPolicyForShift(shiftType) {
  const solverShift = toSolverShiftType(shiftType);
  if (solverShift.isDayOff) return undefined;
  const span = Math.max(0, Number(solverShift.endMinutes) - Number(solverShift.startMinutes));
  const segments = plannedBreakTemplates(span).map(({ type, duration, targetOffset }) => ({
    type,
    duration,
    targetOffset
  }));
  return {
    totalMinutes: segments.reduce((sum, segment) => sum + segment.duration, 0),
    segments
  };
}

export function normalizeShiftBreakPolicy(shiftType, candidate = shiftType?.breakPolicy) {
  const solverShift = toSolverShiftType(shiftType);
  if (solverShift.isDayOff) {
    return { breakPolicy: undefined, breakPolicyValid: true, breakPolicyIssues: [] };
  }
  const breakPolicy = candidate === undefined
    ? createDefaultBreakPolicyForShift(shiftType)
    : structuredClone(candidate);
  const validation = validateBreakPolicyForShift(
    { ...solverShift, breakPolicy },
    breakPolicy,
    DEFAULT_BREAK_CONSTRAINTS
  );
  return {
    breakPolicy,
    breakPolicyValid: validation.ok,
    breakPolicyIssues: validation.issues
  };
}

export function assertValidSolverBreakPolicies(shiftTypes) {
  const failures = [];
  for (const shiftType of shiftTypes ?? []) {
    const normalized = normalizeShiftBreakPolicy(shiftType);
    if (normalized.breakPolicyValid) continue;
    failures.push(`${shiftType.name || shiftType.code}: ${normalized.breakPolicyIssues.join(" / ")}`);
  }
  if (failures.length) {
    throw new Error(`休憩設定エラーのため月間ソルバーを開始できません。${failures.join(" / ")}`);
  }
}
