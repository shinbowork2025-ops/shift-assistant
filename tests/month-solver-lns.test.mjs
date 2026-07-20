import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LNS_DESTROY_SIZE,
  DEFAULT_MONTH_SOLVER_STRATEGY_WEIGHTS,
  LNS_DESTROY_CELL_CAP,
  LNS_DESTROY_METHODS,
  normalizeMonthSolverStrategyWeights,
  proposeMonthSolverLns,
  selectMonthSolverLnsCells,
  selectMonthSolverStrategy,
  validateMonthSolverLnsCandidate
} from "../js/month-solver-lns.js";
import { createMonthSolverNeighborSource } from "../js/month-solver-neighbors.js";
import { createSeededRandom } from "../js/month-solver-rng.js";
import { createMonthSolverScoreContext } from "../js/month-solver-score.js";
import { solveMonthSchedule } from "../js/month-solver.js";

function lnsPlan() {
  const employees = Array.from({ length: 4 }, (_, index) => ({
    id: `e${index + 1}`,
    name: `Employee ${index + 1}`,
    employmentType: "fulltime",
    fixedOvertimeMinutes: 0
  }));
  const assignments = {};
  for (const employee of employees) {
    assignments[employee.id] = Object.fromEntries(
      Array.from({ length: 14 }, (_, index) => [index + 1, index % 7 === 6 ? "O" : "L"])
    );
  }
  return {
    monthValue: "2026-07",
    daysInMonth: 14,
    employees,
    shiftTypes: [
      { code: "E", name: "Early", start: "09:00", end: "17:00", isWork: true },
      { code: "L", name: "Late", start: "12:00", end: "20:00", isWork: true },
      { code: "O", name: "Off", start: "", end: "", isWork: false }
    ],
    coverageRequirements: [
      { scope: "everyday", start: "09:00", end: "12:00", requiredTotal: 2, requiredByType: {} }
    ],
    selectedEmployeeIds: employees.map((employee) => employee.id),
    selectedShiftCodes: ["E", "L"],
    assignments,
    originalAssignments: structuredClone(assignments),
    fixedValues: Object.fromEntries(employees.map((employee) => [employee.id, {}])),
    allowedCodes: Object.fromEntries(employees.map((employee) => [employee.id, ["E", "L", "O"]])),
    targetDaysOffByEmployee: Object.fromEntries(employees.map((employee) => [employee.id, 2])),
    maxConsecutiveByEmployee: Object.fromEntries(employees.map((employee) => [employee.id, 6])),
    dominantCodeByEmployee: Object.fromEntries(employees.map((employee) => [employee.id, "L"])),
    mutableCells: employees.flatMap((employee) => (
      Array.from({ length: 14 }, (_, index) => ({ employeeId: employee.id, day: index + 1 }))
    ))
  };
}

function setup() {
  const plan = lnsPlan();
  return {
    plan,
    context: createMonthSolverScoreContext(plan),
    source: createMonthSolverNeighborSource(plan)
  };
}

test("LNS constants and the initial 60/20/20 strategy ratio are fixed", () => {
  assert.equal(DEFAULT_LNS_DESTROY_SIZE, 8);
  assert.equal(LNS_DESTROY_CELL_CAP, 24);
  assert.deepEqual(LNS_DESTROY_METHODS, [
    "violation",
    "shortageDay",
    "employeeWeek",
    "multipleEmployees",
    "random"
  ]);
  assert.deepEqual(DEFAULT_MONTH_SOLVER_STRATEGY_WEIGHTS, {
    smallNeighbor: 0.6,
    repair: 0.2,
    lns: 0.2
  });
  assert.equal(selectMonthSolverStrategy(() => 0.599), "smallNeighbor");
  assert.equal(selectMonthSolverStrategy(() => 0.600), "repair");
  assert.equal(selectMonthSolverStrategy(() => 0.799), "repair");
  assert.equal(selectMonthSolverStrategy(() => 0.800), "lns");
  assert.deepEqual(normalizeMonthSolverStrategyWeights({ smallNeighbor: 0, repair: 0, lns: 0 }), {
    smallNeighbor: 1,
    repair: 0,
    lns: 0
  });
});

test("all five destroy methods select deterministic unique mutable regions", () => {
  const { context, source } = setup();
  const mutable = new Set(source.mutableCells.map((cell) => `${cell.employeeId}:${cell.day}`));
  for (const method of LNS_DESTROY_METHODS) {
    const first = selectMonthSolverLnsCells(
      context,
      source,
      createSeededRandom(`lns:${method}`),
      { destroyMethod: method, destroySize: 8 }
    );
    const second = selectMonthSolverLnsCells(
      context,
      source,
      createSeededRandom(`lns:${method}`),
      { destroyMethod: method, destroySize: 8 }
    );
    assert.equal(first.method, method);
    assert.equal(first.cells.length, 8);
    assert.equal(new Set(first.cells.map((cell) => `${cell.employeeId}:${cell.day}`)).size, 8);
    assert.ok(first.cells.every((cell) => mutable.has(`${cell.employeeId}:${cell.day}`)));
    assert.deepEqual(first, second);
  }
});

test("LNS repairs three or more cells atomically without mutating its input", () => {
  const { plan, context, source } = setup();
  const before = structuredClone(plan.assignments);
  const lns = proposeMonthSolverLns(
    context,
    source,
    createSeededRandom("atomic-lns"),
    { destroyMethod: "shortageDay", destroySize: 8 }
  );

  assert.equal(lns.strategy, "lns");
  assert.equal(lns.destroyMethod, "shortageDay");
  assert.equal(lns.invariant.ok, true);
  assert.ok(lns.changes.length >= 3);
  assert.ok(lns.evaluation.objective.scalar < context.objective.scalar);
  const destroyed = new Set(lns.destroyedCells.map((cell) => `${cell.employeeId}:${cell.day}`));
  assert.ok(lns.changes.every((change) => destroyed.has(`${change.employeeId}:${change.day}`)));
  assert.deepEqual(plan.assignments, before);
  assert.deepEqual(context.plan.assignments, before);
});

test("the invariant gate rejects changes outside the destroyed region and work/off changes", () => {
  const { context, source } = setup();
  const cells = [{ employeeId: "e1", day: 1 }];
  const result = validateMonthSolverLnsCandidate(context, source, cells, [
    { employeeId: "e1", day: 1, before: "L", after: "O" },
    { employeeId: "e2", day: 1, before: "L", after: "E" }
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === "dayOffCountChanged"));
  assert.ok(result.failures.some((failure) => failure.code === "unexpectedChange"));

  const malformed = validateMonthSolverLnsCandidate(context, source, cells, [
    { employeeId: "missing", day: 99, before: "L", after: "E" }
  ]);
  assert.equal(malformed.ok, false);
  assert.ok(malformed.failures.some((failure) => failure.code === "malformedChange"));
});

test("the integrated solver selects all strategies deterministically", () => {
  const run = () => solveMonthSchedule(lnsPlan(), {
    masterSeed: 20260720,
    iterations: 100,
    repairCellCount: 4,
    lnsDestroySize: 8
  });
  const first = run();
  const second = run();
  const strategies = first.statistics.strategies;
  assert.equal(
    strategies.smallNeighbor.selections + strategies.repair.selections + strategies.lns.selections,
    100
  );
  assert.ok(strategies.smallNeighbor.selections > strategies.repair.selections);
  assert.ok(strategies.smallNeighbor.selections > strategies.lns.selections);
  assert.ok(strategies.repair.selections > 0);
  assert.ok(strategies.lns.selections > 0);
  assert.deepEqual(first.plan.assignments, second.plan.assignments);
  assert.deepEqual(first.statistics, second.statistics);
});
