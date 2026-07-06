import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthSolverPlan, monthSolverChanges } from "../js/month-solver-plan.js";

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
