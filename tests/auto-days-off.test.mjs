import test from "node:test";
import assert from "node:assert/strict";
import { buildDaysOffPlan, findDefaultDaysOffShiftCode } from "../js/auto-days-off.js";

const shiftTypes = [
  { code: "01", name: "01", isWork: true },
  { code: "休", name: "公休", isWork: false },
  { code: "Y", name: "有給休暇", isWork: false }
];

function employee(id, order, pattern = "5on2off", targetDaysOff = 0) {
  return {
    id,
    name: id,
    order,
    restPatternId: pattern,
    restPatternOffset: -1,
    targetDaysOff,
    fixedDaysOff: []
  };
}

test("公休区分の既定候補を選ぶ", () => {
  assert.equal(findDefaultDaysOffShiftCode(shiftTypes), "休");
});

test("従業員ごとの開始位置をずらして公休を計画する", () => {
  const plan = buildDaysOffPlan({
    monthValue: "2026-07",
    employees: [employee("e1", 1), employee("e2", 2)],
    shiftTypes,
    shifts: {},
    shiftLocks: {},
    offShiftCode: "休",
    mode: "empty-only"
  });
  assert.equal(plan.summary.processedEmployees, 2);
  assert.ok(plan.summary.placed > 0);
  const e1Days = plan.changes.filter((item) => item.employeeId === "e1").map((item) => item.day);
  const e2Days = plan.changes.filter((item) => item.employeeId === "e2").map((item) => item.day);
  assert.notDeepEqual(e1Days, e2Days);
});

test("ロック済みセルと既存シフトを空欄限定モードで維持する", () => {
  const plan = buildDaysOffPlan({
    monthValue: "2026-07",
    employees: [{ ...employee("e1", 1, "2on1off", 2), restPatternOffset: 0 }],
    shiftTypes,
    shifts: {
      "2026-07": {
        e1: {
          "2026-07-03": "01",
          "2026-07-06": "Y"
        }
      }
    },
    shiftLocks: {
      "2026-07": { e1: { "2026-07-03": true } }
    },
    offShiftCode: "休",
    mode: "empty-only"
  });
  assert.equal(plan.changes.some((item) => item.day === 3), false);
  assert.equal(plan.changes.some((item) => item.day === 6), false);
  assert.equal(plan.employeeResults[0].actualDaysOff, 2);
});

test("再配置モードでは未ロックの公休を別日に移動できる", () => {
  const plan = buildDaysOffPlan({
    monthValue: "2026-07",
    employees: [{ ...employee("e1", 1, "2on1off", 1), restPatternOffset: 0 }],
    shiftTypes,
    shifts: {
      "2026-07": {
        e1: {
          "2026-07-01": "休",
          "2026-07-03": "01"
        }
      }
    },
    shiftLocks: {},
    offShiftCode: "休",
    mode: "replace-unlocked"
  });
  assert.ok(plan.changes.some((item) => item.day === 1 && item.after === ""));
  assert.ok(plan.changes.some((item) => item.day !== 1 && item.after === "休"));
  assert.equal(plan.changes.some((item) => item.day === 3 && item.after === "休"), false);
});

test("固定休曜日はパターン休日数を増やさず優先位置として使う", () => {
  const plan = buildDaysOffPlan({
    monthValue: "2026-07",
    employees: [{ ...employee("e1", 1, "5on2off", 0), restPatternOffset: 0, fixedDaysOff: [0] }],
    shiftTypes,
    shifts: {},
    shiftLocks: {},
    offShiftCode: "休",
    mode: "empty-only"
  });
  const result = plan.employeeResults[0];
  assert.equal(result.targetDaysOff, 8);
  const selectedDays = new Set(plan.changes.filter((item) => item.after === "休").map((item) => item.day));
  assert.equal(selectedDays.has(5), true);
  assert.equal(selectedDays.has(12), true);
});

test("休み方未設定の従業員は変更しない", () => {
  const plan = buildDaysOffPlan({
    monthValue: "2026-07",
    employees: [employee("e1", 1, "none")],
    shiftTypes,
    shifts: {},
    shiftLocks: {},
    offShiftCode: "休",
    mode: "empty-only"
  });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.summary.skippedEmployees, 1);
});
