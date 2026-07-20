import { proposeMonthSolverRepair } from "./month-solver-repair.js";
import { validateMonthSolverPlan } from "./month-solver-score.js";

export const DEFAULT_LNS_DESTROY_SIZE = 8;
export const LNS_DESTROY_CELL_CAP = 24;
export const LNS_DESTROY_METHODS = Object.freeze([
  "violation",
  "shortageDay",
  "employeeWeek",
  "multipleEmployees",
  "random"
]);
export const DEFAULT_MONTH_SOLVER_STRATEGY_WEIGHTS = Object.freeze({
  smallNeighbor: 0.60,
  repair: 0.20,
  lns: 0.20
});

function cellKey(cell) {
  return `${cell.employeeId}:${cell.day}`;
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function uniqueCells(items) {
  const seen = new Set();
  return items.filter((cell) => {
    const key = cellKey(cell);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankedDays(context) {
  return [...context.dayMetrics.values()].sort((left, right) => (
    (Number(right.shortagePeople) || 0) - (Number(left.shortagePeople) || 0)
    || (Number(right.shortageSlots) || 0) - (Number(left.shortageSlots) || 0)
    || left.day - right.day
  ));
}

function rankedEmployees(context) {
  return [...context.employeeMetrics.values()].sort((left, right) => (
    (Number(right.internalViolationCount) || 0) - (Number(left.internalViolationCount) || 0)
    || (Number(right.internalViolationAmount) || 0) - (Number(left.internalViolationAmount) || 0)
    || (Number(right.hardViolations) || 0) - (Number(left.hardViolations) || 0)
    || (Number(right.overtimeExcess) || 0) - (Number(left.overtimeExcess) || 0)
    || String(left.employeeId).localeCompare(String(right.employeeId))
  ));
}

function chooseFromTop(items, random, limit = 3) {
  if (!items.length) return null;
  const candidates = items.slice(0, Math.min(limit, items.length));
  return candidates[Math.floor(random() * candidates.length)];
}

function completeRegion(preferred, allCells, size, random) {
  const first = uniqueCells(preferred);
  const selected = first.slice(0, size);
  if (selected.length >= size) return selected;
  const selectedKeys = new Set(selected.map(cellKey));
  for (const cell of shuffled(allCells, random)) {
    if (selectedKeys.has(cellKey(cell))) continue;
    selected.push(cell);
    selectedKeys.add(cellKey(cell));
    if (selected.length >= size) break;
  }
  return selected;
}

function violationRegion(context, source, size, random) {
  const employee = chooseFromTop(rankedEmployees(context), random);
  const cells = source.byEmployee.get(employee?.employeeId) ?? [];
  if (!cells.length) return completeRegion([], source.mutableCells, size, random);
  const pivot = cells[Math.floor(random() * cells.length)]?.day ?? cells[0].day;
  const preferred = [...cells].sort((left, right) => (
    Math.abs(left.day - pivot) - Math.abs(right.day - pivot)
    || left.day - right.day
  ));
  return completeRegion(preferred, source.mutableCells, size, random);
}

function shortageDayRegion(context, source, size, random) {
  const dayMetric = chooseFromTop(rankedDays(context), random);
  const pivot = dayMetric?.day ?? 1;
  const preferred = [...source.mutableCells].sort((left, right) => (
    Math.abs(left.day - pivot) - Math.abs(right.day - pivot)
    || left.day - right.day
    || String(left.employeeId).localeCompare(String(right.employeeId))
  ));
  return completeRegion(preferred, source.mutableCells, size, random);
}

function employeeWeekRegion(context, source, size, random) {
  const employeeIds = [...source.byEmployee.keys()].sort((left, right) => String(left).localeCompare(String(right)));
  const employeeId = employeeIds[Math.floor(random() * employeeIds.length)];
  const employeeCells = source.byEmployee.get(employeeId) ?? [];
  const pivot = employeeCells[Math.floor(random() * employeeCells.length)]?.day ?? 1;
  const weekStart = Math.floor((pivot - 1) / 7) * 7 + 1;
  const weekEnd = weekStart + 6;
  const preferred = [
    ...employeeCells.filter((cell) => cell.day >= weekStart && cell.day <= weekEnd),
    ...source.mutableCells.filter((cell) => (
      cell.employeeId !== employeeId && cell.day >= weekStart && cell.day <= weekEnd
    ))
  ].sort((left, right) => (
    Number(left.employeeId !== employeeId) - Number(right.employeeId !== employeeId)
    || left.day - right.day
    || String(left.employeeId).localeCompare(String(right.employeeId))
  ));
  return completeRegion(preferred, source.mutableCells, size, random);
}

function multipleEmployeesRegion(context, source, size, random) {
  const ranked = rankedEmployees(context).map((metric) => metric.employeeId);
  const employeeIds = uniqueCells(shuffled(ranked.map((employeeId) => ({ employeeId, day: 0 })), random))
    .slice(0, Math.min(3, ranked.length))
    .map((cell) => cell.employeeId);
  const selectedEmployees = new Set(employeeIds);
  const preferred = source.mutableCells.filter((cell) => selectedEmployees.has(cell.employeeId));
  return completeRegion(shuffled(preferred, random), source.mutableCells, size, random);
}

function randomRegion(context, source, size, random) {
  return shuffled(source.mutableCells, random).slice(0, size);
}

export function normalizeMonthSolverStrategyWeights(value = {}) {
  const candidate = value && typeof value === "object" ? value : {};
  const weights = Object.fromEntries(Object.entries(DEFAULT_MONTH_SOLVER_STRATEGY_WEIGHTS).map(([key, fallback]) => {
    const configured = Number(candidate[key]);
    return [key, Number.isFinite(configured) && configured >= 0 ? configured : fallback];
  }));
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return { smallNeighbor: 1, repair: 0, lns: 0 };
  return Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key, weight / total]));
}

export function selectMonthSolverStrategy(random, weights = DEFAULT_MONTH_SOLVER_STRATEGY_WEIGHTS) {
  const normalized = normalizeMonthSolverStrategyWeights(weights);
  const draw = random();
  if (draw < normalized.smallNeighbor) return "smallNeighbor";
  if (draw < normalized.smallNeighbor + normalized.repair) return "repair";
  return "lns";
}

export function selectMonthSolverLnsCells(context, source, random, options = {}) {
  const size = Math.max(1, Math.min(
    LNS_DESTROY_CELL_CAP,
    Math.floor(Number(options.destroySize ?? DEFAULT_LNS_DESTROY_SIZE) || DEFAULT_LNS_DESTROY_SIZE)
  ));
  const method = LNS_DESTROY_METHODS.includes(options.destroyMethod)
    ? options.destroyMethod
    : LNS_DESTROY_METHODS[Math.floor(random() * LNS_DESTROY_METHODS.length)];
  const cells = method === "violation"
    ? violationRegion(context, source, size, random)
    : method === "shortageDay"
      ? shortageDayRegion(context, source, size, random)
      : method === "employeeWeek"
        ? employeeWeekRegion(context, source, size, random)
        : method === "multipleEmployees"
          ? multipleEmployeesRegion(context, source, size, random)
          : randomRegion(context, source, size, random);
  return { method, cells: uniqueCells(cells).slice(0, size) };
}

export function validateMonthSolverLnsCandidate(context, source, cells, changes) {
  const failures = [];
  const repairCells = new Set(cells.map(cellKey));
  const mutableCells = new Set(source.mutableCells.map(cellKey));
  const changedCells = new Set();
  for (const change of changes ?? []) {
    if (!change || typeof change.employeeId !== "string" || !Number.isInteger(Number(change.day))) {
      failures.push({ code: "malformedChange" });
      continue;
    }
    const key = cellKey(change);
    const assignmentRow = context.plan.assignments?.[change.employeeId];
    if (!assignmentRow || !Object.hasOwn(assignmentRow, change.day)) {
      failures.push({ code: "malformedChange", key });
      continue;
    }
    if (changedCells.has(key)) failures.push({ code: "duplicateChange", key });
    changedCells.add(key);
    if (!repairCells.has(key)) failures.push({ code: "unexpectedChange", key });
    if (!mutableCells.has(key) || context.plan.fixedValues?.[change.employeeId]?.[change.day] !== undefined) {
      failures.push({ code: "lockedCellChanged", key });
    }
    const before = context.plan.assignments?.[change.employeeId]?.[change.day] ?? "";
    if (change.before !== before) failures.push({ code: "beforeMismatch", key });
    if (!(context.plan.allowedCodes?.[change.employeeId] ?? []).includes(change.after)) {
      failures.push({ code: "unusableShift", key });
    }
    const beforeWork = source.typeMap.get(before)?.isWork;
    const afterWork = source.typeMap.get(change.after)?.isWork;
    if (beforeWork === undefined || beforeWork !== afterWork) {
      failures.push({ code: "dayOffCountChanged", key });
    }
  }
  const candidatePlan = structuredClone(context.plan);
  for (const change of changes ?? []) {
    if (!candidatePlan.assignments?.[change?.employeeId]
      || !Object.hasOwn(candidatePlan.assignments[change.employeeId], change.day)) continue;
    candidatePlan.assignments[change.employeeId][change.day] = change.after;
  }
  const complete = validateMonthSolverPlan(candidatePlan);
  for (const issue of complete.issues) failures.push({ code: "invalidCompletePlan", issue });
  return { ok: failures.length === 0, failures };
}

export function proposeMonthSolverLns(context, source, random, options = {}) {
  const destruction = selectMonthSolverLnsCells(context, source, random, options);
  if (!destruction.cells.length) return null;
  const repair = proposeMonthSolverRepair(context, source, {
    cells: destruction.cells,
    forceBeam: true,
    beamWidth: options.beamWidth,
    exactCandidateCap: options.exactCandidateCap
  });
  if (!repair) return null;
  const invariant = validateMonthSolverLnsCandidate(
    context,
    source,
    destruction.cells,
    repair.changes
  );
  return {
    ...repair,
    strategy: "lns",
    destroyMethod: destruction.method,
    destroyedCells: destruction.cells,
    invariant
  };
}
