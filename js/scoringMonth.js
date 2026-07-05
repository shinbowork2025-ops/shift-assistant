import { dateKey, getDayInfo, timeToMinutes } from "./date-time.js";
import { getRestPattern } from "./rest-patterns.js";
import { overtimeMinutesForShift } from "./shift-metrics.js";
import { checkHard, score } from "./scoring.js";
import { generateGreedyRestPlan } from "./rest-greedy.js";
import { restGapMinutes } from "./work-shift-planner-core.js";

const DEFAULT_MONTH_WEIGHTS = Object.freeze({
  daysOffDeviation: 220,
  maxConsecutiveExcess: 2200,
  overtimeExcess: 0.4,
  shortRest: 4500,
  weekendFairness: 45,
  lateShiftFairness: 45
});

function variance(values) {
  if (!values.length) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
}

function assignmentAt(plan, employeeId, day) {
  return plan.assignments?.[employeeId]?.[day] ?? "";
}

function requiredCoverageForDay(plan, config, day) {
  const dateValue = dateKey(plan.monthValue, day);
  return config.requiredCoverageByDate?.[dateValue]
    ?? config.requiredCoverageByDay?.[day]
    ?? config.requiredCoverage
    ?? undefined;
}

function targetDaysOff(employee, daysInMonth) {
  const explicit = Number(employee.targetDaysOff);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(daysInMonth, Math.round(explicit));
  const pattern = getRestPattern(employee.restPatternId);
  if (pattern.cycle.length) {
    const offCount = pattern.cycle.filter((item) => item === 0).length;
    return Math.round(daysInMonth * offCount / pattern.cycle.length);
  }
  return Math.min(daysInMonth, 8);
}

function longestWorkStreak(codes, typeMap) {
  let longest = 0;
  let current = 0;
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

function isLateShift(shiftType) {
  if (!shiftType?.isWork) return false;
  const start = timeToMinutes(shiftType.start);
  const end = timeToMinutes(shiftType.end);
  return (start ?? 0) >= 12 * 60 || (end ?? 0) >= 20 * 60;
}

function employeeStats(plan, employee, typeMap, config) {
  const codes = [];
  let workDays = 0;
  let daysOff = 0;
  let overtimeMinutes = 0;
  let weekendWorkDays = 0;
  let lateShiftDays = 0;
  let shortRestCount = 0;
  let previousWorkShift = null;

  for (let day = 1; day <= plan.daysInMonth; day += 1) {
    const code = assignmentAt(plan, employee.id, day);
    const shiftType = typeMap.get(code) ?? null;
    codes.push(code);
    if (shiftType?.isWork) {
      workDays += 1;
      overtimeMinutes += overtimeMinutesForShift(shiftType);
      const info = getDayInfo(plan.monthValue, day);
      if (info.weekday === 0 || info.weekday === 6) weekendWorkDays += 1;
      if (isLateShift(shiftType)) lateShiftDays += 1;
      if (previousWorkShift && restGapMinutes(previousWorkShift, shiftType) < Number(config.minimumRestMinutes ?? 660)) {
        shortRestCount += 1;
      }
      previousWorkShift = shiftType;
    } else {
      daysOff += 1;
      previousWorkShift = null;
    }
  }

  const targetOff = targetDaysOff(employee, plan.daysInMonth);
  const maxConsecutive = longestWorkStreak(codes, typeMap);
  const maxAllowed = Math.max(1, Number(employee.maxConsecutiveWorkDays ?? config.maxConsecutiveWorkDays ?? 6) || 6);
  const fixedOvertime = Math.max(0, Number(employee.fixedOvertimeMinutes) || 0);
  const raw = {
    daysOffDeviation: (daysOff - targetOff) ** 2,
    maxConsecutiveExcess: Math.max(0, maxConsecutive - maxAllowed) ** 2,
    overtimeExcess: Math.max(0, overtimeMinutes - fixedOvertime) ** 2,
    shortRest: shortRestCount ** 2
  };
  const weights = { ...DEFAULT_MONTH_WEIGHTS, ...(config.monthWeights ?? {}) };
  const penalty = raw.daysOffDeviation * weights.daysOffDeviation
    + raw.maxConsecutiveExcess * weights.maxConsecutiveExcess
    + raw.overtimeExcess * weights.overtimeExcess
    + raw.shortRest * weights.shortRest;

  return {
    employeeId: employee.id,
    workDays,
    daysOff,
    targetDaysOff: targetOff,
    overtimeMinutes,
    fixedOvertimeMinutes: fixedOvertime,
    maxConsecutive,
    maxAllowedConsecutive: maxAllowed,
    weekendWorkDays,
    lateShiftDays,
    shortRestCount,
    raw,
    penalty
  };
}

export function buildDayPlan(plan, day) {
  const typeMap = new Map(plan.shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
  const employees = [];
  for (const employee of plan.employees) {
    const shiftType = typeMap.get(assignmentAt(plan, employee.id, day));
    if (!shiftType?.isWork) continue;
    employees.push({
      id: employee.id,
      name: employee.name,
      order: employee.order,
      shiftStart: timeToMinutes(shiftType.start),
      shiftEnd: timeToMinutes(shiftType.end),
      breaks: []
    });
  }
  const dayPlan = { dateValue: dateKey(plan.monthValue, day), employees };
  const breaks = generateGreedyRestPlan(dayPlan);
  for (const employee of employees) employee.breaks = breaks[employee.id] ?? [];
  return dayPlan;
}

export function evaluateMonthDay(plan, day, config = {}) {
  const dayPlan = buildDayPlan(plan, day);
  const scoringConfig = {
    ...(config.dayScoring ?? {}),
    requiredCoverage: requiredCoverageForDay(plan, config, day)
  };
  const result = score(dayPlan, scoringConfig);
  const hard = checkHard(dayPlan, scoringConfig);
  return { day, dateValue: dayPlan.dateValue, dayPlan, result, hard };
}

function fairnessResult(statsMap, selectedEmployeeIds, weights) {
  const selected = [...selectedEmployeeIds]
    .map((employeeId) => statsMap.get(employeeId))
    .filter(Boolean);
  const raw = {
    weekendFairness: variance(selected.map((stats) => stats.weekendWorkDays)),
    lateShiftFairness: variance(selected.map((stats) => stats.lateShiftDays))
  };
  return {
    raw,
    penalty: raw.weekendFairness * weights.weekendFairness
      + raw.lateShiftFairness * weights.lateShiftFairness
  };
}

function finalResult(dayTotal, employeePenalty, fairness, dayEvaluations, employeeStatsMap) {
  const dailyBreakdown = { understaffing: 0, concurrentBreaks: 0, targetDeviation: 0 };
  for (const evaluation of dayEvaluations.values()) {
    const weighted = evaluation.result.breakdown?.weighted ?? {};
    dailyBreakdown.understaffing += Number(weighted.understaffing) || 0;
    dailyBreakdown.concurrentBreaks += Number(weighted.concurrentBreaks) || 0;
    dailyBreakdown.targetDeviation += Number(weighted.targetDeviation) || 0;
  }
  return {
    total: dayTotal + employeePenalty + fairness.penalty,
    breakdown: {
      daily: dayTotal,
      dailyBreakdown,
      employee: employeePenalty,
      fairness: fairness.penalty,
      fairnessRaw: fairness.raw
    },
    employeeStats: Object.fromEntries([...employeeStatsMap.entries()].map(([id, stats]) => [id, { ...stats }]))
  };
}

export function createMonthScoreContext(plan, config = {}) {
  const typeMap = new Map(plan.shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
  const selectedEmployeeIds = new Set(plan.selectedEmployeeIds ?? plan.employees.map((employee) => employee.id));
  const dayEvaluations = new Map();
  let dayTotal = 0;
  for (let day = 1; day <= plan.daysInMonth; day += 1) {
    const evaluation = evaluateMonthDay(plan, day, config);
    dayEvaluations.set(day, evaluation);
    dayTotal += evaluation.result.total;
  }

  const employeeStatsMap = new Map();
  let employeePenalty = 0;
  for (const employee of plan.employees) {
    const stats = employeeStats(plan, employee, typeMap, config);
    employeeStatsMap.set(employee.id, stats);
    if (selectedEmployeeIds.has(employee.id)) employeePenalty += stats.penalty;
  }
  const weights = { ...DEFAULT_MONTH_WEIGHTS, ...(config.monthWeights ?? {}) };
  const fairness = fairnessResult(employeeStatsMap, selectedEmployeeIds, weights);

  const context = {
    plan,
    config,
    typeMap,
    selectedEmployeeIds,
    dayEvaluations,
    employeeStatsMap,
    dayTotal,
    employeePenalty,
    fairness,
    result: null
  };
  context.result = finalResult(dayTotal, employeePenalty, fairness, dayEvaluations, employeeStatsMap);
  return context;
}

function fixedValue(plan, employeeId, day) {
  return plan.fixedValues?.[employeeId]?.[day];
}

function requested(plan, employeeId, day) {
  return plan.requestedOff?.[employeeId]?.[day] === true;
}

export function validateMonthChanges(context, changes) {
  const publicHolidayCode = context.plan.publicHolidayCode;
  const allowed = context.plan.allowedCodes ?? {};
  for (const change of changes) {
    const expected = fixedValue(context.plan, change.employeeId, change.day);
    if (expected !== undefined && expected !== change.after) return false;
    if (requested(context.plan, change.employeeId, change.day) && change.after !== publicHolidayCode) return false;
    if (expected === undefined) {
      const allowedCodes = allowed[change.employeeId] ?? [];
      if (!allowedCodes.includes(change.after)) return false;
    }
  }
  return true;
}

export function evaluateMonthChanges(context, changes) {
  if (!changes.length || !validateMonthChanges(context, changes)) return null;
  const previous = changes.map((change) => ({
    ...change,
    before: assignmentAt(context.plan, change.employeeId, change.day)
  }));
  for (const change of changes) context.plan.assignments[change.employeeId][change.day] = change.after;

  const affectedDays = new Set(changes.map((change) => change.day));
  const affectedEmployees = new Set(changes.map((change) => change.employeeId));
  const nextDayEvaluations = new Map(context.dayEvaluations);
  let nextDayTotal = context.dayTotal;
  let valid = true;
  for (const day of affectedDays) {
    const oldEvaluation = context.dayEvaluations.get(day);
    const newEvaluation = evaluateMonthDay(context.plan, day, context.config);
    if (!newEvaluation.hard.ok) valid = false;
    nextDayTotal += newEvaluation.result.total - oldEvaluation.result.total;
    nextDayEvaluations.set(day, newEvaluation);
  }

  const nextEmployeeStats = new Map(context.employeeStatsMap);
  let nextEmployeePenalty = context.employeePenalty;
  for (const employeeId of affectedEmployees) {
    const employee = context.plan.employees.find((item) => item.id === employeeId);
    const oldStats = context.employeeStatsMap.get(employeeId);
    const newStats = employeeStats(context.plan, employee, context.typeMap, context.config);
    nextEmployeeStats.set(employeeId, newStats);
    if (context.selectedEmployeeIds.has(employeeId)) nextEmployeePenalty += newStats.penalty - oldStats.penalty;
    if (context.config.maxConsecutiveHard && newStats.maxConsecutive > newStats.maxAllowedConsecutive) valid = false;
  }

  const weights = { ...DEFAULT_MONTH_WEIGHTS, ...(context.config.monthWeights ?? {}) };
  const nextFairness = fairnessResult(nextEmployeeStats, context.selectedEmployeeIds, weights);
  const result = finalResult(nextDayTotal, nextEmployeePenalty, nextFairness, nextDayEvaluations, nextEmployeeStats);

  for (const change of previous) context.plan.assignments[change.employeeId][change.day] = change.before;
  if (!valid) return null;
  return {
    changes: previous.map((change, index) => ({ ...changes[index], before: change.before })),
    dayEvaluations: nextDayEvaluations,
    employeeStatsMap: nextEmployeeStats,
    dayTotal: nextDayTotal,
    employeePenalty: nextEmployeePenalty,
    fairness: nextFairness,
    result
  };
}

export function applyMonthEvaluation(context, evaluation) {
  for (const change of evaluation.changes) context.plan.assignments[change.employeeId][change.day] = change.after;
  context.dayEvaluations = evaluation.dayEvaluations;
  context.employeeStatsMap = evaluation.employeeStatsMap;
  context.dayTotal = evaluation.dayTotal;
  context.employeePenalty = evaluation.employeePenalty;
  context.fairness = evaluation.fairness;
  context.result = evaluation.result;
  return context;
}

export function scoreMonth(plan, config = {}) {
  return createMonthScoreContext(plan, config).result;
}

export function checkHardMonth(plan, config = {}) {
  const issues = [];
  for (const employee of plan.employees) {
    for (let day = 1; day <= plan.daysInMonth; day += 1) {
      const code = assignmentAt(plan, employee.id, day);
      const fixed = fixedValue(plan, employee.id, day);
      if (fixed !== undefined && fixed !== code) issues.push(`${employee.name} ${day}日: 固定セルが変更されています。`);
      if (requested(plan, employee.id, day) && code !== plan.publicHolidayCode) {
        issues.push(`${employee.name} ${day}日: 希望休が公休になっていません。`);
      }
    }
  }
  for (let day = 1; day <= plan.daysInMonth; day += 1) {
    const hard = evaluateMonthDay(plan, day, config).hard;
    for (const issue of hard.issues) issues.push(`${day}日: ${issue}`);
  }
  if (config.maxConsecutiveHard) {
    const context = createMonthScoreContext(plan, config);
    for (const stats of context.employeeStatsMap.values()) {
      if (stats.maxConsecutive > stats.maxAllowedConsecutive) {
        issues.push(`${stats.employeeId}: 最大連勤を超えています。`);
      }
    }
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}
