import { activeRequirementsForWeekday } from "./coverage-requirements.js";
import { dateKey, getDayInfo, minutesToTime, timeToMinutes } from "./date-time.js";
import { normalizeEmploymentType } from "./employment-types.js";
import { isManualBreakLockedInData } from "./manual-break-locks.js";
import { archivedCandidates, archiveStatistics } from "./month-solver-archive.js";
import { createEstimateMetrics } from "./month-solver-worker-protocol.js";
import { placeBreaksForDay } from "./solver/break-placement.js";
import { normalizeShiftBreakPolicy, toSolverShiftType } from "./solver/shift-adapter.js";
import { SLOTS_PER_DAY } from "./solver/solver-config.js";

function clone(value) {
  return structuredClone(value);
}

function scopeId(type, key = "") {
  return type === "total" ? "total" : `${type}:${key}`;
}

function addRequirementBand(groups, type, key, count, startMinute, endMinute) {
  const required = Math.max(0, Number(count) || 0);
  if (required === 0 || startMinute === null || endMinute === null || endMinute <= startMinute) return;
  const id = scopeId(type, key);
  if (!groups.has(id)) groups.set(id, {
    scope: type === "total" ? { type: "total" } : { type, key },
    slots: new Float64Array(SLOTS_PER_DAY)
  });
  const slots = groups.get(id).slots;
  const first = Math.max(0, Math.floor(startMinute / 15));
  const last = Math.min(SLOTS_PER_DAY, Math.ceil(endMinute / 15));
  for (let slot = first; slot < last; slot += 1) slots[slot] = Math.max(slots[slot], required);
}

function compressRequirementGroups(groups) {
  const result = [];
  for (const { scope, slots } of groups.values()) {
    let startSlot = 0;
    while (startSlot < slots.length) {
      const count = slots[startSlot];
      if (count <= 0) {
        startSlot += 1;
        continue;
      }
      let endSlot = startSlot + 1;
      while (endSlot < slots.length && slots[endSlot] === count) endSlot += 1;
      result.push({ scope, count, startSlot, endSlot });
      startSlot = endSlot;
    }
  }
  return result;
}

export function placementRequirementsForDay(plan, day) {
  const weekday = getDayInfo(plan.monthValue, day).weekday;
  const active = activeRequirementsForWeekday(plan.coverageRequirements, weekday);
  const groups = new Map();
  for (const requirement of active) {
    const start = timeToMinutes(requirement.start);
    const end = timeToMinutes(requirement.end);
    addRequirementBand(groups, "total", "", requirement.requiredTotal, start, end);
    for (const [employmentType, count] of Object.entries(requirement.requiredByType ?? {})) {
      addRequirementBand(groups, "employmentType", employmentType, count, start, end);
    }
    addRequirementBand(
      groups,
      "department",
      requirement.requiredDepartment,
      requirement.requiredDepartmentCount,
      start,
      end
    );
    addRequirementBand(
      groups,
      "qualification",
      requirement.requiredQualification,
      requirement.requiredQualificationCount,
      start,
      end
    );
  }
  return compressRequirementGroups(groups);
}

function solverShiftTypes(plan) {
  return new Map((plan.shiftTypes ?? []).map((shiftType) => {
    const normalized = normalizeShiftBreakPolicy(shiftType);
    return [shiftType.code, toSolverShiftType({
      ...shiftType,
      breakPolicy: normalized.breakPolicy
    })];
  }));
}

function fixedBreaksForDay(plan, dateValue) {
  return Object.fromEntries((plan.employees ?? [])
    .filter((employee) => isManualBreakLockedInData(plan.manualBreakLocks, dateValue, employee.id))
    .map((employee) => [employee.id, clone(plan.breaks?.[dateValue]?.[employee.id] ?? [])])
    .filter(([, breaks]) => breaks.length > 0));
}

function storedPlacements(placements) {
  return Object.fromEntries(Object.entries(placements ?? {})
    .map(([employeeId, items]) => [employeeId, items.map((item) => ({
      type: item.type,
      ...(item.label ? { label: item.label } : {}),
      start: minutesToTime(item.startMinute),
      end: minutesToTime(item.endMinute)
    }))])
    .filter(([, items]) => items.length > 0));
}

function aggregateScopes(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    target[key] = (target[key] ?? 0) + Number(value || 0);
  }
}

export function finalizeArchivedCandidate(candidate, options = {}) {
  const plan = candidate.plan;
  const shifts = options.solverShiftTypes ?? solverShiftTypes(plan);
  const dayPlacementCache = options.dayPlacementCache ?? new Map();
  const requirementsByDay = options.requirementsByDay ?? new Map();
  const finalBreaks = clone(plan.breaks ?? {});
  const finalShortageByScope = {};
  const finalShortageBySlot = [];
  const finalAttributeShortageBySlot = [];
  const dailyStatistics = [];
  const shortageReports = [];
  const unplacedSegments = [];

  for (let day = 1; day <= plan.daysInMonth; day += 1) {
    const dateValue = dateKey(plan.monthValue, day);
    const daySignature = (plan.employees ?? [])
      .map((employee) => `${employee.id}=${plan.assignments?.[employee.id]?.[day] ?? ""}`)
      .join("|");
    const assignments = (plan.employees ?? []).map((employee, order) => ({
      employee: {
        ...employee,
        employmentType: normalizeEmploymentType(employee.employmentType)
      },
      employeeId: employee.id,
      displayOrder: employee.order ?? order,
      shiftType: shifts.get(plan.assignments?.[employee.id]?.[day])
    })).filter((assignment) => assignment.shiftType && !assignment.shiftType.isDayOff);
    const fixedBreaks = fixedBreaksForDay(plan, dateValue);
    const workingIds = new Set(assignments.map((assignment) => assignment.employeeId));
    const orphanedFixedBreakIds = Object.keys(fixedBreaks).filter((employeeId) => !workingIds.has(employeeId));
    if (!requirementsByDay.has(day)) {
      requirementsByDay.set(day, placementRequirementsForDay(plan, day));
    }
    const cacheKey = `${day}:${daySignature}`;
    let placement = dayPlacementCache.get(cacheKey);
    if (!placement) {
      placement = placeBreaksForDay({
        date: dateValue,
        assignments,
        coverageRequirements: requirementsByDay.get(day),
        fixedBreaks,
        seed: `${options.masterSeed ?? 1}:${cacheKey}`
      });
      if (orphanedFixedBreakIds.length > 0) {
        placement = {
          ...placement,
          ok: false,
          unplacedSegments: [
            ...placement.unplacedSegments,
            ...orphanedFixedBreakIds.map((employeeId) => ({
              employeeId,
              segmentIndex: 0,
              type: fixedBreaks[employeeId][0]?.type,
              duration: 0,
              reason: "fixedBreakConflict"
            }))
          ]
        };
      }
      dayPlacementCache.set(cacheKey, placement);
    }
    if (!placement.ok) {
      unplacedSegments.push(...placement.unplacedSegments.map((item) => ({ date: dateValue, ...item })));
    }
    const stored = storedPlacements(placement.placements);
    if (Object.keys(stored).length > 0) finalBreaks[dateValue] = stored;
    else delete finalBreaks[dateValue];
    aggregateScopes(finalShortageByScope, placement.finalShortageByScope);
    finalShortageBySlot.push(...placement.finalShortageBySlot);
    finalAttributeShortageBySlot.push(...placement.finalAttributeShortageBySlot);
    dailyStatistics.push({ day, date: dateValue, ...placement.statistics });
    const attributeShortage = [...placement.finalAttributeShortageBySlot]
      .reduce((sum, value) => sum + value, 0);
    if (placement.finalShortagePersonSlots > 0 || attributeShortage > 0) {
      const activeBands = activeRequirementsForWeekday(
        plan.coverageRequirements,
        getDayInfo(plan.monthValue, day).weekday
      );
      shortageReports.push({
        day,
        shortagePeople: placement.finalShortagePersonSlots,
        shortageSlots: [...placement.finalShortageBySlot].filter((value) => value > 0).length,
        attributeShortagePersonSlots: attributeShortage,
        messages: activeBands.map((requirement) => `${requirement.start}〜${requirement.end}`)
      });
    }
  }

  const finalShortagePersonSlots = finalShortageByScope.total ?? 0;
  const finalAttributeShortagePersonSlots = Object.entries(finalShortageByScope)
    .filter(([key]) => key !== "total")
    .reduce((sum, [, value]) => sum + value, 0);
  const placementOk = unplacedSegments.length === 0;
  return {
    ...candidate,
    classification: placementOk ? candidate.classification : "invalid",
    placementOk,
    finalBreaks,
    finalShortagePersonSlots,
    finalAttributeShortagePersonSlots,
    finalShortageByScope,
    finalShortageBySlot,
    finalAttributeShortageBySlot,
    estimateMetrics: createEstimateMetrics(candidate.estimatedShortageBySlot, finalShortageBySlot),
    shortageReports,
    unplacedSegments,
    placementStatistics: {
      days: dailyStatistics,
      generatedCandidates: dailyStatistics.reduce((sum, item) => sum + item.generatedCandidates, 0),
      improvementMoves: dailyStatistics.reduce((sum, item) => sum + item.improvementMoves, 0),
      pairImprovementMoves: dailyStatistics.reduce((sum, item) => sum + item.pairImprovementMoves, 0)
    }
  };
}

function classificationRank(value) {
  if (value === "feasible") return 0;
  if (value === "repairable") return 1;
  return 2;
}

export function compareFinalizedCandidates(first, second) {
  const classification = classificationRank(first.classification) - classificationRank(second.classification);
  if (classification !== 0) return classification;
  const objectiveKeys = [
    "statutoryViolationCount",
    "statutoryViolationAmount",
    "internalViolationCount",
    "internalViolationAmount"
  ];
  for (const key of objectiveKeys) {
    const difference = (Number(first.objective?.[key]) || 0) - (Number(second.objective?.[key]) || 0);
    if (difference !== 0) return difference;
  }
  const values = [
    [first.finalShortagePersonSlots, second.finalShortagePersonSlots],
    [first.finalAttributeShortagePersonSlots, second.finalAttributeShortagePersonSlots],
    [first.objective?.overtime, second.objective?.overtime],
    [Number(first.objective?.preference || 0) + Number(first.objective?.fairness || 0),
      Number(second.objective?.preference || 0) + Number(second.objective?.fairness || 0)],
    [first.changedCellCount, second.changedCellCount]
  ];
  for (const [left, right] of values) {
    const difference = (Number(left) || 0) - (Number(right) || 0);
    if (difference !== 0) return difference;
  }
  return String(first.signature ?? "").localeCompare(String(second.signature ?? ""));
}

export function finalizeMonthSolverCandidates(archives, options = {}) {
  const source = archivedCandidates(archives);
  const sharedOptions = source.length ? {
    ...options,
    solverShiftTypes: solverShiftTypes(source[0].plan),
    dayPlacementCache: new Map(),
    requirementsByDay: new Map()
  } : options;
  const finalized = source
    .map((candidate) => finalizeArchivedCandidate(candidate, sharedOptions))
    .sort(compareFinalizedCandidates);
  const valid = finalized.filter((candidate) => candidate.classification !== "invalid");
  return {
    best: valid[0] ?? null,
    finalized,
    statistics: {
      ...archiveStatistics(archives),
      finalizedCandidates: finalized.length,
      invalidCandidates: finalized.length - valid.length
    }
  };
}
