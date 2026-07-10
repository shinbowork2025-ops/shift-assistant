import { plannedBreakTemplates } from "./break-rules.js";
import { scheduleBreaks } from "./break-scheduler.js";
import { activeRequirementsForWeekday, evaluateCoverage } from "./coverage-requirements.js";
import { getDayInfo, timeToMinutes } from "./date-time.js";
import { EMPLOYMENT_TYPES, normalizeEmploymentType } from "./employment-types.js";
import { overtimeMinutesForShift, shiftDurationMinutes } from "./shift-metrics.js";
import { normalizePreferredShiftCode } from "./work-shift-preferences.js";
import { restGapMinutes } from "./work-shift-planner-core.js";

const SLOT_MINUTES = 15;
const SLOT_COUNT = 96;
const MINIMUM_REST_MINUTES = 11 * 60;

function assignmentCode(plan, employeeId, day) {
  return plan.assignments?.[employeeId]?.[day] ?? "";
}

function variance(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
}

function isLateShift(shiftType) {
  if (!shiftType?.isWork) return false;
  const start = timeToMinutes(shiftType.start) ?? 0;
  const end = timeToMinutes(shiftType.end) ?? 0;
  return start >= 12 * 60 || end >= 20 * 60;
}

function slotIsInside(start, end, slot) {
  return slot >= start && slot < end;
}

function breakCoversSlot(items, slot) {
  return items.some((item) => slotIsInside(item.startMinute, item.endMinute, slot));
}

function coverageMap(names) {
  return Object.fromEntries([...new Set(names.filter(Boolean))].map((name) => [name, Array(SLOT_COUNT).fill(0)]));
}

export function evaluateSolverDay(plan, day, typeMap = null) {
  const shiftTypesByCode = typeMap ?? new Map(plan.shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
  const assignments = [];
  for (const employee of plan.employees) {
    const code = assignmentCode(plan, employee.id, day);
    const shiftType = shiftTypesByCode.get(code) ?? null;
    if (!shiftType?.isWork) continue;
    const shiftStart = timeToMinutes(shiftType.start);
    const shiftEnd = timeToMinutes(shiftType.end);
    if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart) continue;
    assignments.push({
      id: employee.id,
      employmentType: normalizeEmploymentType(employee.employmentType),
      department: employee.department ?? "",
      qualifications: Array.isArray(employee.qualifications) ? employee.qualifications : [],
      shiftStart,
      shiftEnd,
      templates: plannedBreakTemplates(shiftDurationMinutes(shiftType)),
      movable: true,
      existingBreaks: []
    });
  }

  const scheduled = scheduleBreaks(assignments);
  const slots = Array.from({ length: SLOT_COUNT }, (_, index) => index * SLOT_MINUTES);
  const coverage = Array(SLOT_COUNT).fill(0);
  const coverageByType = Object.fromEntries(EMPLOYMENT_TYPES.map((type) => [type.code, Array(SLOT_COUNT).fill(0)]));
  const weekday = getDayInfo(plan.monthValue, day).weekday;
  const activeRequirements = activeRequirementsForWeekday(plan.coverageRequirements, weekday);
  const coverageByDepartment = coverageMap(activeRequirements.map((item) => item.requiredDepartment));
  const coverageByQualification = coverageMap(activeRequirements.map((item) => item.requiredQualification));

  for (const assignment of assignments) {
    const breaks = scheduled.get(assignment.id) ?? [];
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (!slotIsInside(assignment.shiftStart, assignment.shiftEnd, slot) || breakCoversSlot(breaks, slot)) continue;
      coverage[index] += 1;
      coverageByType[assignment.employmentType][index] += 1;
      if (coverageByDepartment[assignment.department]) coverageByDepartment[assignment.department][index] += 1;
      for (const qualification of assignment.qualifications) {
        if (coverageByQualification[qualification]) coverageByQualification[qualification][index] += 1;
      }
    }
  }

  const evaluation = evaluateCoverage({
    activeRequirements,
    slots,
    coverage,
    coverageByType,
    coverageByDepartment,
    coverageByQualification
  });
  const shortagePeople = evaluation.perSlot.reduce((sum, slot) => sum + slot.shortagePeople, 0);
  return {
    day,
    shortagePeople,
    shortageSlots: evaluation.shortageSlotCount,
    coveragePenalty: shortagePeople * 1000 + evaluation.shortageSlotCount,
    requirementMessages: evaluation.messages,
    breaksByEmployee: Object.fromEntries(
      [...scheduled.entries()].map(([employeeId, items]) => [employeeId, items.map((item) => ({ ...item }))])
    )
  };
}

function longestWorkStreak(codes, typeMap) {
  let current = 0;
  let longest = 0;
  for (const code of codes) {
    if (typeMap.get(code)?.isWork) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function trailingWorkCodes(codes, typeMap) {
  const result = [];
  for (let index = codes.length - 1; index >= 0; index -= 1) {
    if (!typeMap.get(codes[index])?.isWork) break;
    result.unshift(codes[index]);
  }
  return result;
}

function leadingWorkCodes(codes, typeMap) {
  const result = [];
  for (const code of codes) {
    if (!typeMap.get(code)?.isWork) break;
    result.push(code);
  }
  return result;
}

export function evaluateSolverEmployee(plan, employee, typeMap = null) {
  const shiftTypesByCode = typeMap ?? new Map(plan.shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
  const currentCodes = [];
  const shiftCounts = new Map();
  let daysOff = 0;
  let weekendWorkDays = 0;
  let lateShiftDays = 0;
  let overtimeMinutes = 0;
  let shortRestCount = 0;
  let preferencePenalty = 0;
  const boundary = plan.boundaryAssignments?.[employee.id] ?? {};
  let previousWorkShift = boundary.previousKnown
    ? shiftTypesByCode.get(boundary.previousCodes?.at(-1)) ?? null
    : null;
  if (!previousWorkShift?.isWork) previousWorkShift = null;
  const allowedCodes = new Set(plan.allowedCodes?.[employee.id] ?? []);
  const configuredPreferredCode = normalizePreferredShiftCode(employee.preferredShiftCode);
  const preferredCode = allowedCodes.has(configuredPreferredCode) ? configuredPreferredCode : "";
  const configuredDominantCode = plan.dominantCodeByEmployee?.[employee.id] ?? "";
  const dominantCode = allowedCodes.has(configuredDominantCode) ? configuredDominantCode : "";

  for (let day = 1; day <= plan.daysInMonth; day += 1) {
    const code = assignmentCode(plan, employee.id, day);
    const shiftType = shiftTypesByCode.get(code) ?? null;
    const originalCode = plan.originalAssignments?.[employee.id]?.[day] ?? "";
    currentCodes.push(code);
    if (originalCode && originalCode !== code) preferencePenalty += 1;
    if (!shiftType?.isWork) {
      daysOff += 1;
      previousWorkShift = null;
      continue;
    }

    shiftCounts.set(code, (shiftCounts.get(code) ?? 0) + 1);
    overtimeMinutes += overtimeMinutesForShift(shiftType);
    const weekday = getDayInfo(plan.monthValue, day).weekday;
    if (weekday === 0 || weekday === 6) weekendWorkDays += 1;
    if (isLateShift(shiftType)) lateShiftDays += 1;
    if (previousWorkShift && restGapMinutes(previousWorkShift, shiftType) < MINIMUM_REST_MINUTES) shortRestCount += 1;
    previousWorkShift = shiftType;
    if (preferredCode && code !== preferredCode) preferencePenalty += 10;
    else if (!preferredCode && dominantCode && code !== dominantCode) preferencePenalty += 2;
  }

  if (boundary.nextKnown && previousWorkShift) {
    const firstNext = shiftTypesByCode.get(boundary.nextCodes?.[0]) ?? null;
    if (firstNext?.isWork && restGapMinutes(previousWorkShift, firstNext) < MINIMUM_REST_MINUTES) shortRestCount += 1;
  }

  const combinedBoundaryCodes = [
    ...(boundary.previousKnown ? trailingWorkCodes(boundary.previousCodes ?? [], shiftTypesByCode) : []),
    ...currentCodes,
    ...(boundary.nextKnown ? leadingWorkCodes(boundary.nextCodes ?? [], shiftTypesByCode) : [])
  ];
  const maxConsecutive = longestWorkStreak(combinedBoundaryCodes, shiftTypesByCode);
  const maxAllowed = Number(plan.maxConsecutiveByEmployee?.[employee.id] ?? 6) || 6;
  const consecutiveExcess = Math.max(0, maxConsecutive - maxAllowed);
  const hardViolations = shortRestCount + (consecutiveExcess * consecutiveExcess);
  const fixedOvertime = Math.max(0, Number(employee.fixedOvertimeMinutes) || 0);
  const overtimeExcess = Math.max(0, overtimeMinutes - fixedOvertime);
  const targetDaysOff = Number(plan.targetDaysOffByEmployee?.[employee.id] ?? 0) || 0;
  const daysOffDeviation = Math.abs(daysOff - targetDaysOff);
  const workDays = Math.max(0, plan.daysInMonth - daysOff);
  const shiftConcentration = workDays > 0
    ? [...shiftCounts.values()].reduce((sum, count) => sum + count * count, 0) / workDays
    : 0;

  return {
    employeeId: employee.id,
    daysOff,
    targetDaysOff,
    daysOffDeviation,
    weekendWorkDays,
    lateShiftDays,
    overtimeMinutes,
    overtimeExcess,
    shortRestCount,
    maxConsecutive,
    maxAllowed,
    boundaryPreviousKnown: Boolean(boundary.previousKnown),
    boundaryNextKnown: Boolean(boundary.nextKnown),
    hardViolations,
    shiftConcentration,
    preferencePenalty
  };
}

function composeObjective(dayMetrics, employeeMetrics, selectedEmployeeIds) {
  const selected = new Set(selectedEmployeeIds);
  const days = [...dayMetrics.values()];
  const employees = [...employeeMetrics.values()].filter((metric) => selected.has(metric.employeeId));
  const shortagePeople = days.reduce((sum, metric) => sum + metric.shortagePeople, 0);
  const shortageSlots = days.reduce((sum, metric) => sum + metric.shortageSlots, 0);
  const coverage = shortagePeople * 1000 + shortageSlots;
  const hard = employees.reduce((sum, metric) => sum + metric.hardViolations, 0);
  const overtime = employees.reduce((sum, metric) => sum + metric.overtimeExcess, 0);
  const daysOffFairness = employees.reduce((sum, metric) => sum + metric.daysOffDeviation ** 2, 0);
  const fairness = daysOffFairness * 25
    + variance(employees.map((metric) => metric.weekendWorkDays)) * 20
    + variance(employees.map((metric) => metric.lateShiftDays)) * 20
    + employees.reduce((sum, metric) => sum + metric.shiftConcentration, 0);
  const preference = employees.reduce((sum, metric) => sum + metric.preferencePenalty, 0);
  const vector = [shortagePeople, shortageSlots, hard, overtime, fairness, preference];
  const scalar = shortagePeople * 1e7
    + shortageSlots * 1e5
    + hard * 1e4
    + overtime * 10
    + fairness
    + preference * 0.1;
  return { vector, scalar, coverage, shortagePeople, shortageSlots, hard, overtime, fairness, preference };
}

export function compareSolverObjectives(a, b) {
  for (let index = 0; index < a.vector.length; index += 1) {
    if (a.vector[index] < b.vector[index]) return -1;
    if (a.vector[index] > b.vector[index]) return 1;
  }
  return 0;
}

export function createMonthSolverScoreContext(plan) {
  const typeMap = new Map(plan.shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
  const dayMetrics = new Map();
  for (let day = 1; day <= plan.daysInMonth; day += 1) dayMetrics.set(day, evaluateSolverDay(plan, day, typeMap));
  const employeeMetrics = new Map();
  for (const employee of plan.employees) employeeMetrics.set(employee.id, evaluateSolverEmployee(plan, employee, typeMap));
  return {
    plan,
    typeMap,
    dayMetrics,
    employeeMetrics,
    objective: composeObjective(dayMetrics, employeeMetrics, plan.selectedEmployeeIds)
  };
}

function isAllowed(plan, employeeId, code) {
  const fixed = plan.fixedValues?.[employeeId];
  if (!fixed) return false;
  return (plan.allowedCodes?.[employeeId] ?? []).includes(code);
}

export function evaluateMonthSolverChanges(context, changes) {
  if (!Array.isArray(changes) || !changes.length) return null;
  const normalized = [];
  for (const change of changes) {
    const current = assignmentCode(context.plan, change.employeeId, change.day);
    if (context.plan.fixedValues?.[change.employeeId]?.[change.day] !== undefined) return null;
    if (!isAllowed(context.plan, change.employeeId, change.after) || current === change.after) return null;
    normalized.push({ ...change, before: current });
  }
  for (const change of normalized) context.plan.assignments[change.employeeId][change.day] = change.after;
  const affectedDays = new Set(normalized.map((change) => change.day));
  const affectedEmployees = new Set(normalized.map((change) => change.employeeId));
  const dayMetrics = new Map(context.dayMetrics);
  const employeeMetrics = new Map(context.employeeMetrics);
  for (const day of affectedDays) dayMetrics.set(day, evaluateSolverDay(context.plan, day, context.typeMap));
  for (const employeeId of affectedEmployees) {
    const employee = context.plan.employees.find((item) => item.id === employeeId);
    employeeMetrics.set(employeeId, evaluateSolverEmployee(context.plan, employee, context.typeMap));
  }
  const objective = composeObjective(dayMetrics, employeeMetrics, context.plan.selectedEmployeeIds);
  for (const change of normalized) context.plan.assignments[change.employeeId][change.day] = change.before;
  return { changes: normalized, dayMetrics, employeeMetrics, objective };
}

export function applyMonthSolverEvaluation(context, evaluation) {
  for (const change of evaluation.changes) context.plan.assignments[change.employeeId][change.day] = change.after;
  context.dayMetrics = evaluation.dayMetrics;
  context.employeeMetrics = evaluation.employeeMetrics;
  context.objective = evaluation.objective;
  return context;
}

export function scoreMonthSolverPlan(plan) {
  return createMonthSolverScoreContext(plan).objective;
}

export function validateMonthSolverPlan(plan) {
  const issues = [];
  for (const employee of plan.employees) {
    for (let day = 1; day <= plan.daysInMonth; day += 1) {
      const code = assignmentCode(plan, employee.id, day);
      const fixed = plan.fixedValues?.[employee.id]?.[day];
      if (fixed !== undefined && fixed !== code) issues.push(`${employee.name}・${day}日の固定セルが変更されています。`);
      if (fixed === undefined && !(plan.allowedCodes?.[employee.id] ?? []).includes(code)) {
        issues.push(`${employee.name}・${day}日に使用不可のシフトがあります。`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
