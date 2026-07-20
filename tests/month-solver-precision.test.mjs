import test from "node:test";
import assert from "node:assert/strict";
import { solveMonthSchedulePrecisionAsync } from "../js/month-solver.js";
import { compareSolverObjectives } from "../js/month-solver-score.js";

const shiftTypes = [
  { code: "E", name: "早番", start: "09:00", end: "17:00", isWork: true, overtimeMinutes: 0 },
  { code: "L", name: "遅番", start: "12:00", end: "20:00", isWork: true, overtimeMinutes: 0 },
  { code: "休", name: "公休", start: "", end: "", isWork: false, overtimeMinutes: 0 }
];

function precisionPlan() {
  const employees = [
    { id: "e1", name: "田中", employmentType: "fulltime", avoidLateEarly: true, fixedOvertimeMinutes: 0 },
    { id: "e2", name: "佐藤", employmentType: "parttime", avoidLateEarly: true, fixedOvertimeMinutes: 0 }
  ];
  return {
    monthValue: "2026-07",
    daysInMonth: 2,
    employees,
    shiftTypes,
    coverageRequirements: [
      { scope: "everyday", start: "09:00", end: "12:00", requiredTotal: 1, requiredByType: {} },
      { scope: "everyday", start: "17:00", end: "20:00", requiredTotal: 1, requiredByType: {} }
    ],
    selectedEmployeeIds: employees.map((employee) => employee.id),
    publicHolidayCode: "休",
    assignments: {
      e1: { 1: "L", 2: "L" },
      e2: { 1: "L", 2: "L" }
    },
    originalAssignments: {
      e1: { 1: "L", 2: "L" },
      e2: { 1: "L", 2: "L" }
    },
    fixedValues: { e1: {}, e2: {} },
    allowedCodes: { e1: ["E", "L", "休"], e2: ["E", "L", "休"] },
    targetDaysOffByEmployee: { e1: 0, e2: 0 },
    maxConsecutiveByEmployee: { e1: 6, e2: 6 },
    dominantCodeByEmployee: { e1: "L", e2: "L" },
    mutableCells: [
      { employeeId: "e1", day: 1 },
      { employeeId: "e1", day: 2 },
      { employeeId: "e2", day: 1 },
      { employeeId: "e2", day: 2 }
    ]
  };
}

test("精密最適化は制限時間内の複数探索から最良案を返す", async () => {
  const progress = [];
  const result = await solveMonthSchedulePrecisionAsync(precisionPlan(), {
    seed: 2026,
    timeLimitMs: 80,
    iterationsPerRestart: 120,
    chunkSize: 20,
    progressEvery: 20,
    progressIntervalMs: 0
  }, {
    onProgress: (value) => progress.push(value)
  });

  assert.equal(result.mode, "precision");
  assert.equal(result.timedOut, true);
  assert.equal(result.stopped, false);
  assert.equal(result.optimalityGuaranteed, false);
  assert.ok(result.restarts >= 1);
  assert.ok(result.iterations > 0);
  const strategies = result.statistics.strategies;
  assert.equal(
    strategies.smallNeighbor.selections + strategies.repair.selections + strategies.lns.selections,
    result.iterations
  );
  assert.ok(Object.values(strategies.lns.destroyMethods).reduce((sum, value) => sum + value, 0)
    <= strategies.lns.attempts);
  assert.ok(progress.some((item) => item.mode === "precision"));
  assert.ok(compareSolverObjectives(result.objective, result.initialObjective) <= 0);
  assert.equal(result.validation.ok, true);
});

test("精密最適化は中断時点の最良案を返す", async () => {
  let stop = false;
  const result = await solveMonthSchedulePrecisionAsync(precisionPlan(), {
    seed: 7,
    timeLimitMs: 2000,
    iterationsPerRestart: 5000,
    chunkSize: 20,
    progressEvery: 20,
    progressIntervalMs: 0
  }, {
    shouldStop: () => stop,
    onProgress: () => { stop = true; }
  });

  assert.equal(result.mode, "precision");
  assert.equal(result.stopped, true);
  assert.equal(result.timedOut, false);
  assert.ok(result.iterations > 0);
  assert.ok(compareSolverObjectives(result.objective, result.initialObjective) <= 0);
  assert.equal(result.validation.ok, true);
});
