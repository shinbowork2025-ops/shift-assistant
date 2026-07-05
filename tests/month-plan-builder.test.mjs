import test from "node:test";
import assert from "node:assert/strict";
import { buildInitialMonthPlan, monthPlanChanges } from "../js/month-plan-builder.js";

const shiftTypes = [
  { code: "A", name: "勤務A", shortLabel: "A", start: "06:45", end: "16:15", isWork: true, overtimeMinutes: 0 },
  { code: "B", name: "勤務B", shortLabel: "B", start: "10:45", end: "20:15", isWork: true, overtimeMinutes: 0 },
  { code: "休", name: "公休", shortLabel: "休", start: "", end: "", isWork: false, paidMinutes: 0, overtimeMinutes: 0 }
];

function employees() {
  return [
    { id: "e1", name: "田中", order: 1, targetDaysOff: 8, restPatternId: "5on2off", allowedShiftCodes: ["A", "B"] },
    { id: "e2", name: "佐藤", order: 2, targetDaysOff: 8, restPatternId: "5on2off", allowedShiftCodes: ["A", "B"] }
  ];
}

test("希望休と入力済みセルを固定した初期案を作る", () => {
  const plan = buildInitialMonthPlan({
    monthValue: "2026-07",
    employees: employees(),
    shiftTypes,
    shifts: { "2026-07": { e1: { "2026-07-01": "A" } } },
    shiftLocks: { "2026-07": { e1: { "2026-07-02": true } } },
    dayOffRequests: { "2026-07": { e1: { "2026-07-05": true } } },
    selectedEmployeeIds: ["e1", "e2"],
    selectedWorkShiftCodes: ["A", "B"]
  });

  assert.equal(plan.assignments.e1[1], "A");
  assert.equal(plan.fixedValues.e1[1], "A");
  assert.equal(plan.fixedValues.e1[2], "");
  assert.equal(plan.assignments.e1[5], "休");
  assert.equal(plan.fixedValues.e1[5], "休");
  for (const employeeId of plan.selectedEmployeeIds) {
    for (let day = 1; day <= plan.daysInMonth; day += 1) {
      if (plan.fixedValues[employeeId]?.[day] === "") continue;
      assert.notEqual(plan.assignments[employeeId][day], "");
    }
  }
});

test("希望休と入力済み勤務の競合を拒否する", () => {
  assert.throws(() => buildInitialMonthPlan({
    monthValue: "2026-07",
    employees: employees(),
    shiftTypes,
    shifts: { "2026-07": { e1: { "2026-07-05": "A" } } },
    shiftLocks: {},
    dayOffRequests: { "2026-07": { e1: { "2026-07-05": true } } },
    selectedEmployeeIds: ["e1"],
    selectedWorkShiftCodes: ["A", "B"]
  }), /競合/);
});

test("元データとの差分だけを適用候補として返す", () => {
  const original = { "2026-07": { e1: { "2026-07-01": "A" } } };
  const plan = buildInitialMonthPlan({
    monthValue: "2026-07",
    employees: employees(),
    shiftTypes,
    shifts: original,
    shiftLocks: {},
    dayOffRequests: {},
    selectedEmployeeIds: ["e1"],
    selectedWorkShiftCodes: ["A", "B"]
  });
  const changes = monthPlanChanges(plan, original);
  assert.equal(changes.some((change) => change.day === 1), false);
  assert.ok(changes.length > 0);
});
