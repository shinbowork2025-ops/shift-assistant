import test from "node:test";
import assert from "node:assert/strict";
import { validateMonthSolverApplication } from "../js/month-solver-application.js";
import {
  createMonthSolverNeighborSource,
  proposeMonthSolverNeighbor
} from "../js/month-solver-neighbors.js";

const shiftTypes = [
  { code: "E", name: "早番", start: "09:00", end: "17:00", isWork: true },
  { code: "L", name: "遅番", start: "12:00", end: "20:00", isWork: true },
  { code: "休", name: "公休", start: "", end: "", isWork: false }
];

function applicationResult(overrides = {}) {
  const plan = {
    monthValue: "2026-07",
    daysInMonth: 2,
    employees: [{ id: "e1", name: "田中" }],
    shiftTypes,
    selectedEmployeeIds: ["e1"],
    assignments: { e1: { 1: "E", 2: "休" } },
    targetDaysOffByEmployee: { e1: 1 },
    ...overrides.plan
  };
  return {
    plan,
    validation: { ok: true, issues: [] },
    objective: { hard: 0, shortagePeople: 0, shortageSlots: 0 },
    ...overrides,
    plan
  };
}

function offCount(plan, employeeId) {
  const typeMap = new Map(plan.shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
  return Object.values(plan.assignments[employeeId]).filter((code) => !typeMap.get(code)?.isWork).length;
}

function randomGenerator(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

test("休日数・勤務制約・必要人数を満たす案だけ適用可能とする", () => {
  assert.equal(validateMonthSolverApplication(applicationResult()).ok, true);

  const daysOffMismatch = applicationResult({
    plan: { assignments: { e1: { 1: "E", 2: "L" } } }
  });
  const daysOffValidation = validateMonthSolverApplication(daysOffMismatch);
  assert.equal(daysOffValidation.ok, false);
  assert.equal(daysOffValidation.daysOffOk, false);
  assert.match(daysOffValidation.issues.join(" / "), /休日数/);

  const hardViolation = applicationResult({
    objective: { hard: 1, shortagePeople: 0, shortageSlots: 0 }
  });
  assert.equal(validateMonthSolverApplication(hardViolation).constraintsOk, false);

  const shortage = applicationResult({
    objective: { hard: 0, shortagePeople: 2, shortageSlots: 3 }
  });
  assert.equal(validateMonthSolverApplication(shortage).coverageOk, false);
  assert.equal(validateMonthSolverApplication(shortage).ok, true);

  const placementFailure = applicationResult({ placementOk: false, classification: "invalid" });
  assert.equal(validateMonthSolverApplication(placementFailure).ok, false);
  assert.equal(validateMonthSolverApplication(placementFailure).placementOk, false);
});

test("月間ソルバーの近傍生成は従業員ごとの休日数を変えない", () => {
  const employees = [
    { id: "e1", name: "田中" },
    { id: "e2", name: "佐藤" }
  ];
  const plan = {
    daysInMonth: 4,
    employees,
    shiftTypes,
    assignments: {
      e1: { 1: "E", 2: "L", 3: "休", 4: "E" },
      e2: { 1: "L", 2: "休", 3: "E", 4: "L" }
    },
    allowedCodes: { e1: ["E", "L", "休"], e2: ["E", "L", "休"] },
    mutableCells: employees.flatMap((employee) =>
      Array.from({ length: 4 }, (_, index) => ({ employeeId: employee.id, day: index + 1 }))
    )
  };
  const source = createMonthSolverNeighborSource(plan);
  const random = randomGenerator(2026);

  for (let index = 0; index < 500; index += 1) {
    const before = Object.fromEntries(employees.map((employee) => [employee.id, offCount(plan, employee.id)]));
    const changes = proposeMonthSolverNeighbor(plan, source, random);
    if (!changes) continue;
    for (const change of changes) plan.assignments[change.employeeId][change.day] = change.after;
    for (const employee of employees) {
      assert.equal(offCount(plan, employee.id), before[employee.id]);
    }
  }
});
