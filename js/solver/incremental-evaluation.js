import { evaluateEstimatedCoverageForDay } from "./coverage-evaluation.js";
import { evaluatePlanFull } from "./evaluate-full.js";
import { SOLVER_CONFIG_VERSION, normalizeSolverWeights } from "./solver-config.js";

function asMap(value, key = "id") {
  if (value instanceof Map) return value;
  if (Array.isArray(value)) return new Map(value.map((item) => [item?.[key], item]));
  return new Map(Object.entries(value && typeof value === "object" ? value : {}));
}

function populationVariance(values) {
  if (!values.length) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
}

function singleEmployeePlan(plan, employeeId) {
  const employeeIndex = plan.employeeOrder.indexOf(employeeId);
  const locks = plan.lockedCells instanceof Set ? plan.lockedCells : new Set(plan.lockedCells ?? []);
  return {
    ...plan,
    employeeOrder: [employeeId],
    assignments: [structuredClone(plan.assignments[employeeIndex])],
    lockedCells: new Set([...locks].filter((key) => String(key).startsWith(`${employeeId}:`)))
  };
}
function singleEmployeeContext(context, plan, employeeId) {
  const employees = asMap(context.employees);
  const baselinePlan = context.baselinePlan
    ? singleEmployeePlan(context.baselinePlan, employeeId)
    : undefined;
  return {
    ...context,
    employees: new Map([[employeeId, structuredClone(employees.get(employeeId) ?? { id: employeeId })]]),
    requirements: [],
    preferences: (context.preferences ?? []).filter((request) => request.employeeId === employeeId),
    ...(baselinePlan ? { baselinePlan } : {})
  };
}

function recomputeEmployee(plan, context, employeeId) {
  return evaluatePlanFull(
    singleEmployeePlan(plan, employeeId),
    singleEmployeeContext(context, plan, employeeId)
  );
}

function addShortages(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function sumEmployee(employeeOrder, employeeResults, key) {
  return employeeOrder.reduce((sum, employeeId) => sum + (employeeResults.get(employeeId)?.[key] ?? 0), 0);
}

function composeResult(plan, context, employeeResults, dayResults, verificationIssues) {
  const employeeOrder = plan.employeeOrder ?? [];
  const weights = normalizeSolverWeights(context?.settings?.weights);
  const statutoryPenalty = sumEmployee(employeeOrder, employeeResults, "statutoryPenalty");
  const internalPenalty = sumEmployee(employeeOrder, employeeResults, "internalPenalty");
  const overtimePenalty = sumEmployee(employeeOrder, employeeResults, "overtimePenalty");
  const preferencePenalty = sumEmployee(employeeOrder, employeeResults, "preferencePenalty");
  const changePenalty = sumEmployee(employeeOrder, employeeResults, "changePenalty");
  const coveragePenalty = [...dayResults.values()]
    .reduce((sum, result) => sum + result.coveragePenalty, 0);
  const statutoryViolationCount = sumEmployee(employeeOrder, employeeResults, "statutoryViolationCount");
  const statutoryViolationAmount = sumEmployee(employeeOrder, employeeResults, "statutoryViolationAmount");
  const internalViolationCount = sumEmployee(employeeOrder, employeeResults, "internalViolationCount");
  const internalViolationAmount = sumEmployee(employeeOrder, employeeResults, "internalViolationAmount");
  const preferenceViolationCount = sumEmployee(employeeOrder, employeeResults, "preferenceViolationCount");
  const preferenceViolationAmount = sumEmployee(employeeOrder, employeeResults, "preferenceViolationAmount");
  const breakdownByEmployee = Object.fromEntries(employeeOrder.map((employeeId) => [
    employeeId,
    structuredClone(employeeResults.get(employeeId)?.breakdownByEmployee?.[employeeId] ?? {})
  ]));
  const weekendDays = employeeOrder.map((employeeId) => breakdownByEmployee[employeeId].weekendWorkDays ?? 0);
  const lateDays = employeeOrder.map((employeeId) => breakdownByEmployee[employeeId].lateShiftDays ?? 0);
  const fairnessPenalty = weights.fairnessUnit * (
    populationVariance(weekendDays) + populationVariance(lateDays)
  );
  const estimatedShortageByScope = {};
  for (const dayResult of dayResults.values()) addShortages(estimatedShortageByScope, dayResult.estimatedShortageByScope);
  const estimatedShortagePersonSlots = estimatedShortageByScope.total ?? 0;
  const violations = [];
  for (const layer of ["statutory", "internal", "preference"]) {
    for (const employeeId of employeeOrder) {
      violations.push(...(employeeResults.get(employeeId)?.violations ?? [])
        .filter((violation) => violation.layer === layer)
        .map((violation) => structuredClone(violation)));
    }
  }
  const score = statutoryPenalty
    + internalPenalty
    + coveragePenalty
    + overtimePenalty
    + preferencePenalty
    + fairnessPenalty
    + changePenalty;
  return {
    solverConfigVersion: SOLVER_CONFIG_VERSION,
    score,
    statutoryPenalty,
    internalPenalty,
    coveragePenalty,
    overtimePenalty,
    preferencePenalty,
    fairnessPenalty,
    changePenalty,
    statutoryViolationCount,
    statutoryViolationAmount,
    internalViolationCount,
    internalViolationAmount,
    preferenceViolationCount,
    preferenceViolationAmount,
    constraintLayers: {
      statutory: {
        violationCount: statutoryViolationCount,
        violationAmount: statutoryViolationAmount,
        penalty: statutoryPenalty
      },
      internal: {
        violationCount: internalViolationCount,
        violationAmount: internalViolationAmount,
        penalty: internalPenalty
      },
      preference: {
        violationCount: preferenceViolationCount,
        violationAmount: preferenceViolationAmount,
        penalty: preferencePenalty
      }
    },
    estimatedShortagePersonSlots,
    estimatedShortageByScope,
    violations,
    verificationIssues: structuredClone(verificationIssues),
    breakdownByEmployee
  };
}

/**
 * 従業員単位・日単位のキャッシュを持つ増分評価コンテキストを生成する。
 * セル変更時は対象従業員の月間指標と対象日の必要人数指標だけを再計算する。
 */
export function createIncrementalEvaluation(planInput, contextInput) {
  const plan = structuredClone(planInput);
  const context = structuredClone(contextInput);
  const employeeIndex = new Map(plan.employeeOrder.map((employeeId, index) => [employeeId, index]));
  const employeeResults = new Map();
  const dayResults = new Map();
  const weights = normalizeSolverWeights(context?.settings?.weights);
  const initialFull = evaluatePlanFull(plan, context);

  function recomputeEmployees(employeeIds) {
    for (const employeeId of employeeIds) {
      employeeResults.set(employeeId, recomputeEmployee(plan, context, employeeId));
    }
  }

  function recomputeDays(days) {
    for (const day of days) {
      dayResults.set(day, evaluateEstimatedCoverageForDay(
        plan,
        day,
        context,
        weights,
        { includeCoverageDetails: true }
      ));
    }
  }

  recomputeEmployees(plan.employeeOrder);
  recomputeDays(Array.from({ length: plan.dayCount }, (_, day) => day));
  let result = composeResult(
    plan,
    context,
    employeeResults,
    dayResults,
    initialFull.verificationIssues
  );
  let lastUpdate = {
    employeeIds: [...plan.employeeOrder],
    days: Array.from({ length: plan.dayCount }, (_, day) => day)
  };

  function applyChanges(changes = []) {
    const affectedEmployees = new Set();
    const affectedDays = new Set();
    for (const change of changes) {
      const row = employeeIndex.get(change.employeeId);
      const day = Number(change.day);
      if (row === undefined || !Number.isInteger(day) || day < 0 || day >= plan.dayCount) {
        throw new Error(`増分評価の変更セルが不正です: ${change.employeeId}:${change.day}`);
      }
      const current = plan.assignments[row][day];
      if (Object.hasOwn(change, "before") && change.before !== current) {
        throw new Error(`増分評価の変更前値が一致しません: ${change.employeeId}:${day}`);
      }
      plan.assignments[row][day] = change.after;
      affectedEmployees.add(change.employeeId);
      affectedDays.add(day);
    }
    recomputeEmployees(affectedEmployees);
    recomputeDays(affectedDays);
    result = composeResult(
      plan,
      context,
      employeeResults,
      dayResults,
      initialFull.verificationIssues
    );
    lastUpdate = {
      employeeIds: [...affectedEmployees].sort((left, right) => (
        employeeIndex.get(left) - employeeIndex.get(right)
      )),
      days: [...affectedDays].sort((left, right) => left - right)
    };
    return result;
  }

  return {
    applyChanges,
    get result() { return result; },
    get plan() { return plan; },
    get employeeMetrics() { return employeeResults; },
    get dayMetrics() { return dayResults; },
    get lastUpdate() { return lastUpdate; }
  };
}
