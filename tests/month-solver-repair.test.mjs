import test from "node:test";
import assert from "node:assert/strict";
import { createMonthSolverNeighborSource } from "../js/month-solver-neighbors.js";
import {
  BRUTE_CELL_CAP,
  BRUTE_COMBO_CAP,
  DEFAULT_BEAM_WIDTH,
  DEFAULT_EXACT_CANDIDATE_CAP,
  REPAIR_CELL_CAP,
  proposeMonthSolverRepair,
  selectRepairCells
} from "../js/month-solver-repair.js";
import { createMonthSolverScoreContext } from "../js/month-solver-score.js";

function repairPlan(employeeCount, shiftCodes = ["E", "L"]) {
  const definitions = {
    E: { code: "E", name: "Early", start: "09:00", end: "17:00", isWork: true },
    M: { code: "M", name: "Middle", start: "10:00", end: "18:00", isWork: true },
    L: { code: "L", name: "Late", start: "12:00", end: "20:00", isWork: true },
    N: { code: "N", name: "Night", start: "13:00", end: "21:00", isWork: true }
  };
  const employees = Array.from({ length: employeeCount }, (_, index) => ({
    id: `e${String(index + 1).padStart(2, "0")}`,
    name: `Employee ${index + 1}`,
    employmentType: "fulltime",
    fixedOvertimeMinutes: 0
  }));
  const assignments = Object.fromEntries(employees.map((employee) => [employee.id, { 1: "L" }]));
  return {
    monthValue: "2026-07",
    daysInMonth: 1,
    employees,
    shiftTypes: shiftCodes.map((code) => definitions[code]),
    coverageRequirements: [
      { scope: "everyday", start: "09:00", end: "12:00", requiredTotal: employeeCount, requiredByType: {} }
    ],
    selectedEmployeeIds: employees.map((employee) => employee.id),
    selectedShiftCodes: shiftCodes,
    assignments,
    originalAssignments: structuredClone(assignments),
    fixedValues: Object.fromEntries(employees.map((employee) => [employee.id, {}])),
    allowedCodes: Object.fromEntries(employees.map((employee) => [employee.id, [...shiftCodes]])),
    targetDaysOffByEmployee: Object.fromEntries(employees.map((employee) => [employee.id, 0])),
    maxConsecutiveByEmployee: Object.fromEntries(employees.map((employee) => [employee.id, 6])),
    dominantCodeByEmployee: Object.fromEntries(employees.map((employee) => [employee.id, "L"])),
    mutableCells: employees.map((employee) => ({ employeeId: employee.id, day: 1 }))
  };
}

function setup(plan) {
  return {
    context: createMonthSolverScoreContext(plan),
    source: createMonthSolverNeighborSource(plan)
  };
}

function assertMatchesFullEvaluation(plan, repair) {
  const changed = structuredClone(plan);
  for (const change of repair.changes) {
    changed.assignments[change.employeeId][change.day] = change.after;
  }
  const full = createMonthSolverScoreContext(changed);
  assert.deepEqual(repair.evaluation.objective, full.objective);
  assert.deepEqual(repair.evaluation.dayMetrics, full.dayMetrics);
  assert.deepEqual(repair.evaluation.employeeMetrics, full.employeeMetrics);
}

test("repair limits are fixed by the v5 contract", () => {
  assert.equal(REPAIR_CELL_CAP, 12);
  assert.equal(BRUTE_CELL_CAP, 8);
  assert.equal(BRUTE_COMBO_CAP, 20_000);
  assert.equal(DEFAULT_BEAM_WIDTH, 30);
  assert.equal(DEFAULT_EXACT_CANDIDATE_CAP, 3);
});

test("small repairs exhaustively choose a deterministic atomic candidate", () => {
  const plan = repairPlan(3);
  const before = structuredClone(plan.assignments);
  const { context, source } = setup(plan);

  const first = proposeMonthSolverRepair(context, source, { cellCount: 3 });
  const second = proposeMonthSolverRepair(context, source, { cellCount: 3 });

  assert.equal(first.method, "brute");
  assert.equal(first.combinationCount, 8);
  assert.equal(first.evaluatedCandidates, 7);
  assert.equal(first.changes.length, 3);
  assert.ok(first.evaluation.objective.scalar < context.objective.scalar);
  assert.deepEqual(first.changes, second.changes);
  assert.deepEqual(first.evaluation.objective, second.evaluation.objective);
  assertMatchesFullEvaluation(plan, first);
  assert.deepEqual(plan.assignments, before);
  assert.deepEqual(context.plan.assignments, before);
});

test("nine to twelve cells use a width-limited deterministic beam", () => {
  const plan = repairPlan(13);
  const { context, source } = setup(plan);
  const selected = selectRepairCells(context, source, { cellCount: 99 });
  assert.equal(selected.length, REPAIR_CELL_CAP);

  const first = proposeMonthSolverRepair(context, source, { cellCount: 9, beamWidth: 30 });
  const second = proposeMonthSolverRepair(context, source, { cellCount: 9, beamWidth: 30 });
  assert.equal(first.method, "beam");
  assert.equal(first.cells.length, 9);
  assert.ok(first.evaluatedCandidates > 0);
  assert.ok(first.evaluatedCandidates <= DEFAULT_EXACT_CANDIDATE_CAP);
  assert.deepEqual(first.changes, second.changes);
  assert.deepEqual(first.evaluation.objective, second.evaluation.objective);
  assertMatchesFullEvaluation(plan, first);
});

test("the combination cap switches an eight-cell repair to beam search", () => {
  const plan = repairPlan(8, ["E", "M", "L", "N"]);
  const { context, source } = setup(plan);
  const repair = proposeMonthSolverRepair(context, source, { cellCount: 8 });

  assert.equal(repair.combinationCount, 65_536);
  assert.equal(repair.method, "beam");
  assert.equal(repair.cells.length, 8);
});

test("a repair region over twelve cells uses greedy fill followed by a beam window", () => {
  const plan = repairPlan(13);
  const before = structuredClone(plan.assignments);
  const { context, source } = setup(plan);
  const repair = proposeMonthSolverRepair(context, source, {
    cells: source.mutableCells,
    beamWidth: 30
  });

  assert.equal(repair.method, "greedyBeam");
  assert.equal(repair.cells.length, 13);
  assert.equal(repair.combinationCount, 8_192);
  assert.ok(repair.evaluatedCandidates > 0);
  assert.ok(repair.evaluatedCandidates <= DEFAULT_EXACT_CANDIDATE_CAP);
  assert.deepEqual(plan.assignments, before);
});
