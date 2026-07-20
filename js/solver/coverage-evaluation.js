import {
  aggregateEstimatedBreakLoad
} from "./break-load-profile.js";
import { SLOT_MINUTES, SLOTS_PER_DAY } from "./solver-config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function asMap(value, key = "id") {
  if (value instanceof Map) return value;
  if (Array.isArray(value)) return new Map(value.map((item) => [item?.[key], item]));
  return new Map(Object.entries(value && typeof value === "object" ? value : {}));
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

function normalizeShiftType(shiftType) {
  if (!shiftType) return null;
  const isDayOff = Boolean(shiftType.isDayOff ?? shiftType.isWork === false);
  return {
    ...shiftType,
    isDayOff,
    startMinutes: isDayOff ? null : parseMinute(shiftType.startMinutes ?? shiftType.start),
    endMinutes: isDayOff ? null : parseMinute(shiftType.endMinutes ?? shiftType.end)
  };
}

function dateAt(periodStart, day) {
  const base = new Date(`${periodStart}T00:00:00.000Z`);
  return new Date(base.getTime() + day * DAY_MS).toISOString().slice(0, 10);
}

function assignmentCode(plan, employeeIndex, day) {
  return plan.assignments?.[employeeIndex]?.[day] ?? null;
}

function manualLock(context, dateValue, employeeId) {
  return Boolean(context?.manualBreakLocks?.[dateValue]?.[employeeId]);
}

function valueAt(container, day, dateValue, employeeId) {
  if (container instanceof Map) {
    return container.get(`${day}:${employeeId}`)
      ?? container.get(`${dateValue}:${employeeId}`)
      ?? container.get(day)?.get?.(employeeId)
      ?? container.get(dateValue)?.get?.(employeeId)
      ?? container.get(day)?.[employeeId]
      ?? container.get(dateValue)?.[employeeId]
      ?? [];
  }
  return container?.[day]?.[employeeId]
    ?? container?.[dateValue]?.[employeeId]
    ?? [];
}

function normalizeFixedBreaks(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      ...item,
      startMinute: parseMinute(item?.startMinute ?? item?.start),
      endMinute: parseMinute(item?.endMinute ?? item?.end)
    }))
    .filter((item) => item.startMinute !== null && item.endMinute !== null && item.endMinute > item.startMinute);
}

function fixedBreaksFor(context, plan, day, employeeId) {
  const dateValue = dateAt(plan.periodStart, day);
  const explicit = valueAt(context?.fixedBreaks, day, dateValue, employeeId);
  if (explicit.length) return normalizeFixedBreaks(explicit);
  if (!manualLock(context, dateValue, employeeId)) return [];
  return normalizeFixedBreaks(valueAt(context?.breaks, day, dateValue, employeeId));
}

function ensureProfile(group, key) {
  if (!group.has(key)) group.set(key, new Float64Array(SLOTS_PER_DAY));
  return group.get(key);
}

function createRawCoverage(assignments) {
  const result = {
    total: new Float64Array(SLOTS_PER_DAY),
    byEmploymentType: new Map(),
    byDepartment: new Map(),
    byQualification: new Map()
  };
  for (const { shiftType, employee } of assignments) {
    if (!shiftType || shiftType.isDayOff) continue;
    for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
      const minute = slot * SLOT_MINUTES;
      if (minute < shiftType.startMinutes || minute >= shiftType.endMinutes) continue;
      result.total[slot] += 1;
      if (employee?.employmentType) {
        ensureProfile(result.byEmploymentType, String(employee.employmentType))[slot] += 1;
      }
      if (employee?.department) {
        ensureProfile(result.byDepartment, String(employee.department))[slot] += 1;
      }
      for (const qualification of employee?.qualifications ?? []) {
        ensureProfile(result.byQualification, String(qualification))[slot] += 1;
      }
    }
  }
  return result;
}

function scopeKey(scope) {
  const type = scope?.type ?? "total";
  return type === "total" ? "total" : `${type}:${String(scope?.key ?? "")}`;
}

function scopeProfile(group, scope) {
  switch (scope?.type ?? "total") {
    case "employmentType": return group.byEmploymentType.get(String(scope.key)) ?? new Float64Array(SLOTS_PER_DAY);
    case "department": return group.byDepartment.get(String(scope.key)) ?? new Float64Array(SLOTS_PER_DAY);
    case "qualification": return group.byQualification.get(String(scope.key)) ?? new Float64Array(SLOTS_PER_DAY);
    default: return group.total;
  }
}

function scopeWeight(weights, scope) {
  return weights.shortagePersonSlot[scope?.type ?? "total"] ?? weights.shortagePersonSlot.total;
}

function requirementsForDay(requirements, day) {
  return requirements.filter((requirement) => (
    !Array.isArray(requirement?.days)
    || requirement.days.map(Number).includes(day)
  ));
}

export function evaluateEstimatedCoverageForDay(plan, day, context, weights, options = {}) {
  const requirements = requirementsForDay(
    Array.isArray(context?.requirements) ? context.requirements : [],
    day
  );
  if (requirements.length === 0 && options.includeCoverageDetails !== true) {
    return {
      day,
      coveragePenalty: 0,
      estimatedShortagePersonSlots: 0,
      estimatedShortageByScope: {},
      rawCoverage: null,
      breakLoad: null
    };
  }
  const shiftTypes = new Map([...asMap(context?.shiftTypes, "code")]
    .map(([code, shiftType]) => [code, normalizeShiftType(shiftType)]));
  const employees = asMap(context?.employees);
  const assignments = [];
  for (let employeeIndex = 0; employeeIndex < (plan.employeeOrder?.length ?? 0); employeeIndex += 1) {
    const employeeId = plan.employeeOrder[employeeIndex];
    const shiftType = shiftTypes.get(assignmentCode(plan, employeeIndex, day));
    if (!shiftType || shiftType.isDayOff) continue;
    assignments.push({
      employee: employees.get(employeeId) ?? { id: employeeId },
      shiftType,
      fixedBreaks: fixedBreaksFor(context, plan, day, employeeId)
    });
  }

  const rawCoverage = createRawCoverage(assignments);
  const breakLoad = aggregateEstimatedBreakLoad(assignments, {
    breakConstraints: context?.settings?.breakConstraints
  });
  let coveragePenalty = 0;
  const estimatedShortageByScope = {};
  for (const requirement of requirements) {
    const raw = scopeProfile(rawCoverage, requirement.scope);
    const load = scopeProfile(breakLoad, requirement.scope);
    const count = Math.max(0, Number(requirement.count) || 0);
    const startSlot = Math.max(0, Math.min(SLOTS_PER_DAY, Math.floor(Number(requirement.startSlot) || 0)));
    const endSlot = Math.max(startSlot, Math.min(SLOTS_PER_DAY, Math.floor(Number(requirement.endSlot) || 0)));
    let shortage = 0;
    for (let slot = startSlot; slot < endSlot; slot += 1) {
      shortage += Math.max(0, count - (raw[slot] - load[slot]));
    }
    if (shortage === 0) continue;
    const key = scopeKey(requirement.scope);
    estimatedShortageByScope[key] = (estimatedShortageByScope[key] ?? 0) + shortage;
    coveragePenalty += shortage * scopeWeight(weights, requirement.scope);
  }
  return {
    day,
    coveragePenalty,
    estimatedShortagePersonSlots: estimatedShortageByScope.total ?? 0,
    estimatedShortageByScope,
    rawCoverage,
    breakLoad
  };
}
