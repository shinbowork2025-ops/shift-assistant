import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthSolverPlan, monthSolverChanges } from "../js/month-solver-plan.js";
import { validateMonthSolverApplication } from "../js/month-solver-application.js";
import { solveMonthSchedule } from "../js/month-solver.js";

const shiftTypes = [
  { code: "A", name: "勤務A", shortLabel: "A", start: "09:00", end: "18:00", isWork: true, overtimeMinutes: 0 },
  { code: "B", name: "勤務B", shortLabel: "B", start: "11:00", end: "20:00", isWork: true, overtimeMinutes: 0 },
  { code: "休", name: "公休", shortLabel: "休", start: "", end: "", isWork: false },
  { code: "Y", name: "有給休暇", shortLabel: "Y", start: "", end: "", isWork: false, paidMinutes: 450 }
];

const employees = [{
  id: "e1",
  name: "田中",
  order: 1,
  employmentType: "fulltime",
  restPatternId: "5on2off",
  targetDaysOff: 8,
  allowedShiftCodes: ["A", "B"],
  avoidLateEarly: true,
  fixedOvertimeMinutes: 0
}];

test("ロック済み勤務と有休を固定し、残りの月間案を埋める", () => {
  const shifts = {
    "2026-07": {
      e1: {
        "2026-07-01": "A",
        "2026-07-02": "Y"
      }
    }
  };
  const plan = buildMonthSolverPlan({
    monthValue: "2026-07",
    employees,
    shiftTypes,
    shifts,
    shiftLocks: { "2026-07": { e1: { "2026-07-01": true } } },
    coverageRequirements: [{ start: "09:00", end: "17:00", requiredTotal: 1 }],
    selectedShiftCodes: ["A", "B"]
  });

  assert.equal(plan.fixedValues.e1[1], "A");
  assert.equal(plan.fixedValues.e1[2], "Y");
  assert.equal(plan.assignments.e1[1], "A");
  assert.equal(plan.assignments.e1[2], "Y");
  assert.deepEqual(plan.coverageRequirements, [{ start: "09:00", end: "17:00", requiredTotal: 1 }]);
  for (let day = 1; day <= 31; day += 1) assert.notEqual(plan.assignments.e1[day], "");
  assert.equal(plan.mutableCells.some((cell) => cell.day === 1), false);
  assert.equal(plan.mutableCells.some((cell) => cell.day === 2), false);
});

test("現在の表との差分だけを返す", () => {
  const shifts = { "2026-07": { e1: { "2026-07-01": "A" } } };
  const plan = buildMonthSolverPlan({
    monthValue: "2026-07",
    employees,
    shiftTypes,
    shifts,
    shiftLocks: { "2026-07": { e1: { "2026-07-01": true } } },
    selectedShiftCodes: ["A", "B"]
  });
  const changes = monthSolverChanges(plan, shifts);
  assert.equal(changes.some((change) => change.day === 1), false);
  assert.ok(changes.length > 0);
});

test("5勤2休の全位相で初期案と適用目標の休日数が一致する", () => {
  for (let phase = 0; phase < 7; phase += 1) {
    const phaseEmployee = {
      ...employees[0],
      targetDaysOff: 0,
      restPatternOffset: phase
    };
    const plan = buildMonthSolverPlan({
      monthValue: "2026-07",
      employees: [phaseEmployee],
      shiftTypes,
      shifts: {},
      shiftLocks: {},
      selectedShiftCodes: ["A", "B"]
    });
    const typeMap = new Map(shiftTypes.map((item) => [item.code, item]));
    const actual = Object.values(plan.assignments.e1)
      .filter((code) => typeMap.get(code)?.isWork === false).length;
    assert.equal(actual, plan.targetDaysOffByEmployee.e1, `位相${phase}の休日数が不一致です`);
    assert.equal(validateMonthSolverApplication({ plan }).daysOffOk, true, `位相${phase}が適用不可です`);
  }
});

test("有休が公休目標を超える場合は維持した実休日数を適用目標にする", () => {
  const paidLeaveRow = Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => [`2026-07-${String(index + 1).padStart(2, "0")}`, "Y"])
  );
  const plan = buildMonthSolverPlan({
    monthValue: "2026-07",
    employees,
    shiftTypes,
    shifts: { "2026-07": { e1: paidLeaveRow } },
    shiftLocks: {},
    selectedShiftCodes: ["A", "B"]
  });
  assert.equal(plan.targetDaysOffByEmployee.e1, 10);
  assert.equal(validateMonthSolverApplication({ plan }).daysOffOk, true);
});

test("31日月の5勤2休を探索した案が休日数の不一致で適用不可にならない", () => {
  const plan = buildMonthSolverPlan({
    monthValue: "2026-07",
    employees: [{ ...employees[0], targetDaysOff: 0, restPatternOffset: 0 }],
    shiftTypes,
    shifts: {},
    shiftLocks: {},
    coverageRequirements: [],
    selectedShiftCodes: ["A", "B"]
  });
  const result = solveMonthSchedule(plan, { iterations: 300, seed: 1 });
  const validation = validateMonthSolverApplication(result);
  assert.equal(validation.daysOffOk, true);
  assert.equal(validation.ok, true);
});
