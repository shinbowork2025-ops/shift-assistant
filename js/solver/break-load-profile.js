import { enumerateBreakPlacementCandidates } from "./break-placement-candidates.js";
import {
  SOLVER_CONFIG_VERSION,
  SLOT_MINUTES,
  SLOTS_PER_DAY,
  normalizeBreakConstraints
} from "./solver-config.js";
import { minutesToSlot } from "./time-slots.js";

export const breakLoadProfileCache = new Map();

function normalizedPolicy(policy) {
  return {
    totalMinutes: Number(policy?.totalMinutes) || 0,
    segments: (policy?.segments ?? []).map((segment) => ({
      type: segment?.type ?? "",
      duration: Number(segment?.duration) || 0,
      targetOffset: Number(segment?.targetOffset) || 0
    }))
  };
}

export function createBreakLoadProfileKey(shiftType, breakPolicy, breakConstraints = {}) {
  return JSON.stringify({
    solverConfigVersion: SOLVER_CONFIG_VERSION,
    startMinutes: Number(shiftType?.startMinutes),
    endMinutes: Number(shiftType?.endMinutes),
    breakPolicy: normalizedPolicy(breakPolicy),
    breakConstraints: normalizeBreakConstraints(breakConstraints)
  });
}

export function clearBreakLoadProfileCache() {
  breakLoadProfileCache.clear();
}

/**
 * 完全配置候補を等確率として、各15分枠が休憩になる期待人数を返す。
 * 同じ設定の返り値はキャッシュされた読み取り専用配列を再利用する。
 */
export function estimatedBreakLoadProfile(
  shiftType,
  breakPolicyOrConstraints = shiftType?.breakPolicy,
  breakConstraints = {}
) {
  const hasPolicyShape = Array.isArray(breakPolicyOrConstraints?.segments);
  const breakPolicy = hasPolicyShape ? breakPolicyOrConstraints : shiftType?.breakPolicy;
  const constraints = hasPolicyShape ? breakConstraints : breakPolicyOrConstraints;
  const profile = new Float64Array(SLOTS_PER_DAY);
  if (!shiftType || shiftType.isDayOff) return profile;

  const key = createBreakLoadProfileKey(shiftType, breakPolicy, constraints);
  if (breakLoadProfileCache.has(key)) return breakLoadProfileCache.get(key);
  const candidates = enumerateBreakPlacementCandidates(
    shiftType,
    breakPolicy,
    [],
    constraints
  );
  if (candidates.length > 0) {
    const probability = 1 / candidates.length;
    for (const candidate of candidates) {
      for (const item of candidate) {
        const firstSlot = minutesToSlot(item.startMinute);
        const slotCount = Number(item.duration) / SLOT_MINUTES;
        for (let offset = 0; offset < slotCount; offset += 1) {
          const slot = firstSlot + offset;
          if (slot >= 0 && slot < profile.length) profile[slot] += probability;
        }
      }
    }
  }
  breakLoadProfileCache.set(key, profile);
  return profile;
}

function emptyAttributeLoad() {
  return {
    total: new Float64Array(SLOTS_PER_DAY),
    byEmploymentType: new Map(),
    byDepartment: new Map(),
    byQualification: new Map()
  };
}

function ensureProfile(group, key) {
  if (!group.has(key)) group.set(key, new Float64Array(SLOTS_PER_DAY));
  return group.get(key);
}

function addProfile(target, source, employee, multiplier = 1) {
  for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
    const value = source[slot] * multiplier;
    if (value === 0) continue;
    target.total[slot] += value;
    if (employee?.employmentType) {
      ensureProfile(target.byEmploymentType, String(employee.employmentType))[slot] += value;
    }
    if (employee?.department) {
      ensureProfile(target.byDepartment, String(employee.department))[slot] += value;
    }
    for (const qualification of employee?.qualifications ?? []) {
      ensureProfile(target.byQualification, String(qualification))[slot] += value;
    }
  }
}

export function fixedBreakLoadProfile(fixedBreaks = []) {
  const profile = new Float64Array(SLOTS_PER_DAY);
  for (const item of Array.isArray(fixedBreaks) ? fixedBreaks : []) {
    const startMinute = Number(item?.startMinute);
    const endMinute = Number(item?.endMinute);
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) continue;
    const firstSlot = Math.max(0, Math.floor(startMinute / SLOT_MINUTES));
    const lastSlot = Math.min(SLOTS_PER_DAY, Math.ceil(endMinute / SLOT_MINUTES));
    for (let slot = firstSlot; slot < lastSlot; slot += 1) profile[slot] = 1;
  }
  return profile;
}

/**
 * 従業員ごとの見込み休憩負荷を、合計・雇用区分・部門・資格へ同じ単位で加算する。
 */
export function aggregateEstimatedBreakLoad(assignments = [], options = {}) {
  const result = emptyAttributeLoad();
  for (const assignment of assignments) {
    const shiftType = assignment?.shiftType ?? assignment?.shift;
    if (!shiftType || shiftType.isDayOff) continue;
    const employee = assignment?.employee ?? assignment;
    const fixedBreaks = assignment?.fixedBreaks ?? [];
    const profile = fixedBreaks.length
      ? fixedBreakLoadProfile(fixedBreaks)
      : estimatedBreakLoadProfile(
        shiftType,
        assignment?.breakPolicy ?? shiftType.breakPolicy,
        options.breakConstraints ?? shiftType.breakConstraints ?? {}
      );
    addProfile(result, profile, employee);
  }
  return result;
}
