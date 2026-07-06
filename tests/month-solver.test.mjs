import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { solveMonthSchedule } from "../js/month-solver.js";
import { compareSolverObjectives, scoreMonthSolverPlan } from "../js/month-solver-score.js";

const shifts = [
  { code: "E", name: "早い勤務", start: "09:00", end: "17:00", isWork: true, overtimeMinutes: 0 },
  { code: "L", name: "遅い勤務", start: "12:00", end: "20:00", isWork: true, overtimeMinutes: 0 },
  { code: "休", name: "公休", start: "", end: "", isWork: false, overtimeMinutes: 0 }
];

function oneDayPlan() {
  const employees = [
    { id: "e1", name: "田中", employmentType: "fulltime", avoidLateEarly: true, fixedOvertimeMinutes: 0 },
    { id: "e2", name: "佐藤", employmentType: "parttime", avoidLateEarly: true, fixedOvertimeMinutes: 0 }
  ];
  return {
    monthValue: "2026-07",
    daysInMonth: 1,
    employees,
    shiftTypes: shifts,
    coverageRequirements: [
      { scope: "everyday", start: "09:00", end: "12:00", requiredTotal: 1, requiredByType: {} },
      { scope: "everyday", start: "17:00", end: "20:00", requiredTotal: 1, requiredByType: {} }
    ],
    selectedEmployeeIds: ["e1", "e2"],
    publicHolidayCode: "休",
    assignments: { e1: { 1: "L" }, e2: { 1: "L" } },
    originalAssignments: { e1: { 1: "L" }, e2: { 1: "L" } },
    fixedValues: { e1: {}, e2: {} },
    allowedCodes: { e1: ["E", "L"], e2: ["E", "L"] },
    targetDaysOffByEmployee: { e1: 0, e2: 0 },
    maxConsecutiveByEmployee: { e1: 6, e2: 6 },
    dominantCodeByEmployee: { e1: "L", e2: "L" },
    mutableCells: [{ employeeId: "e1", day: 1 }, { employeeId: "e2", day: 1 }]
  };
}

test("必要人数不足を最優先に改善する", () => {
  const plan = oneDayPlan();
  const initial = scoreMonthSolverPlan(plan);
  const result = solveMonthSchedule(plan, { seed: 123, iterations: 600 });
  assert.ok(compareSolverObjectives(result.objective, initial) < 0);
  assert.equal(initial.shortagePeople > result.objective.shortagePeople, true);
  assert.equal(result.objective.shortagePeople, 0);
  assert.equal(result.validation.ok, true);
});



test("雇用区分別の必要人数を満たす組合せを優先する", () => {
  const plan = oneDayPlan();
  plan.coverageRequirements = [
    {
      scope: "everyday",
      start: "09:01",
      end: "12:00",
      requiredTotal: 1,
      requiredByType: { fulltime: 1 }
    },
    {
      scope: "everyday",
      start: "17:00",
      end: "20:00",
      requiredTotal: 1,
      requiredByType: { parttime: 1 }
    }
  ];
  const result = solveMonthSchedule(plan, { seed: 31415, iterations: 800 });

  assert.equal(result.objective.shortagePeople, 0);
  assert.equal(result.plan.assignments.e1[1], "E");
  assert.equal(result.plan.assignments.e2[1], "L");
});



test("必要人数を満たすために新しい勤務間隔違反を導入しない", () => {
  const plan = {
    monthValue: "2026-07",
    daysInMonth: 2,
    employees: [{
      id: "e1",
      name: "田中",
      employmentType: "fulltime",
      avoidLateEarly: true,
      fixedOvertimeMinutes: 0
    }],
    shiftTypes: [
      { code: "E", name: "早朝", start: "06:00", end: "14:00", isWork: true, overtimeMinutes: 0 },
      { code: "L", name: "深夜前", start: "14:00", end: "23:00", isWork: true, overtimeMinutes: 0 },
      { code: "休", name: "公休", start: "", end: "", isWork: false, overtimeMinutes: 0 }
    ],
    coverageRequirements: [{
      scope: "everyday",
      start: "06:00",
      end: "14:00",
      requiredTotal: 1,
      requiredByType: {}
    }],
    selectedEmployeeIds: ["e1"],
    publicHolidayCode: "休",
    assignments: { e1: { 1: "L", 2: "L" } },
    originalAssignments: { e1: { 1: "L", 2: "L" } },
    fixedValues: { e1: { 1: "L" } },
    allowedCodes: { e1: ["E", "L", "休"] },
    targetDaysOffByEmployee: { e1: 0 },
    maxConsecutiveByEmployee: { e1: 6 },
    dominantCodeByEmployee: { e1: "L" },
    mutableCells: [{ employeeId: "e1", day: 2 }]
  };
  const result = solveMonthSchedule(plan, { seed: 42, iterations: 800 });

  assert.equal(result.initialObjective.hard, 0);
  assert.equal(result.objective.hard, 0);
  assert.equal(result.plan.assignments.e1[2], "L");
});

test("同じ入力とシードなら同じ案を返す", () => {
  const first = solveMonthSchedule(oneDayPlan(), { seed: 9876, iterations: 500 });
  const second = solveMonthSchedule(oneDayPlan(), { seed: 9876, iterations: 500 });
  assert.deepEqual(first.plan.assignments, second.plan.assignments);
  assert.deepEqual(first.objective, second.objective);
});

function performancePlan() {
  const employees = Array.from({ length: 15 }, (_, index) => ({
    id: `e${index + 1}`,
    name: `従業員${index + 1}`,
    employmentType: index < 5 ? "fulltime" : index < 10 ? "semi" : "parttime",
    avoidLateEarly: true,
    fixedOvertimeMinutes: 0
  }));
  const assignments = {};
  const originalAssignments = {};
  const fixedValues = {};
  const allowedCodes = {};
  const targetDaysOffByEmployee = {};
  const maxConsecutiveByEmployee = {};
  const dominantCodeByEmployee = {};
  const mutableCells = [];
  for (const employee of employees) {
    assignments[employee.id] = {};
    originalAssignments[employee.id] = {};
    fixedValues[employee.id] = {};
    allowedCodes[employee.id] = ["E", "L", "休"];
    targetDaysOffByEmployee[employee.id] = 8;
    maxConsecutiveByEmployee[employee.id] = 6;
    dominantCodeByEmployee[employee.id] = "L";
    for (let day = 1; day <= 31; day += 1) {
      const code = day % 7 === 0 ? "休" : "L";
      assignments[employee.id][day] = code;
      originalAssignments[employee.id][day] = code;
      mutableCells.push({ employeeId: employee.id, day });
    }
  }
  return {
    monthValue: "2026-07",
    daysInMonth: 31,
    employees,
    shiftTypes: shifts,
    coverageRequirements: [{
      scope: "everyday",
      start: "09:00",
      end: "20:00",
      requiredTotal: 6,
      requiredByType: { fulltime: 1, semi: 1, parttime: 1 }
    }],
    selectedEmployeeIds: employees.map((employee) => employee.id),
    publicHolidayCode: "休",
    assignments,
    originalAssignments,
    fixedValues,
    allowedCodes,
    targetDaysOffByEmployee,
    maxConsecutiveByEmployee,
    dominantCodeByEmployee,
    mutableCells
  };
}

test("15人×31日を10秒以内で改善する", (context) => {
  const plan = performancePlan();
  const started = performance.now();
  const result = solveMonthSchedule(plan, { seed: 2026, iterations: 1200 });
  const elapsed = performance.now() - started;
  context.diagnostic(`1200 iterations: ${elapsed.toFixed(1)}ms`);
  assert.ok(elapsed < 10_000, `${elapsed.toFixed(1)}ms`);
  assert.ok(compareSolverObjectives(result.objective, result.initialObjective) <= 0);
  assert.equal(result.validation.ok, true);
});
