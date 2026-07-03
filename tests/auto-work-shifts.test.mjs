import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkShiftPlan } from "../js/auto-work-shifts.js";
import { hasShortRest, restGapMinutes } from "../js/work-shift-planner-core.js";

const shiftTypes = [
  { code: "E", name: "勤務E", shortLabel: "E", start: "06:00", end: "14:00", isWork: true, overtimeMinutes: 0 },
  { code: "M", name: "勤務M", shortLabel: "M", start: "09:00", end: "17:00", isWork: true, overtimeMinutes: 0 },
  { code: "L", name: "勤務L", shortLabel: "L", start: "14:00", end: "22:00", isWork: true, overtimeMinutes: 60 },
  { code: "休", name: "公休", shortLabel: "休", start: "", end: "", isWork: false, overtimeMinutes: 0 },
  { code: "Y", name: "有給", shortLabel: "有", start: "", end: "", isWork: false, overtimeMinutes: 0 }
];

function employee(id, order, settings = {}) {
  return {
    id,
    name: id,
    order,
    fixedOvertimeMinutes: 0,
    allowedShiftCodes: [],
    preferredShiftCode: "",
    avoidLateEarly: true,
    ...settings
  };
}

function offDaysFrom(startDay) {
  const values = {};
  for (let day = startDay; day <= 31; day += 1) {
    values[`2026-07-${String(day).padStart(2, "0")}`] = "休";
  }
  return values;
}

test("勤務間隔を翌日開始までの分数で計算する", () => {
  assert.equal(restGapMinutes(shiftTypes[2], shiftTypes[0]), 8 * 60);
  assert.equal(hasShortRest(shiftTypes[2], shiftTypes[0]), true);
  assert.equal(hasShortRest(shiftTypes[2], shiftTypes[1]), false);
});

test("空欄限定モードは休日・ロック・入力済み勤務を維持する", () => {
  const plan = buildWorkShiftPlan({
    monthValue: "2026-07",
    employees: [employee("e1", 1, { allowedShiftCodes: ["E", "M"], preferredShiftCode: "M" })],
    shiftTypes,
    shifts: {
      "2026-07": {
        e1: {
          "2026-07-01": "休",
          "2026-07-04": "E",
          "2026-07-05": "Y"
        }
      }
    },
    shiftLocks: { "2026-07": { e1: { "2026-07-03": true } } },
    selectedShiftCodes: ["E", "M", "L"],
    mode: "empty-only"
  });

  assert.equal(plan.changes.some((change) => [1, 3, 4, 5].includes(change.day)), false);
  assert.equal(plan.changes.find((change) => change.day === 2)?.after, "M");
  assert.equal(plan.summary.preservedLocked, 1);
  assert.equal(plan.summary.preservedNonWork, 2);
  assert.equal(plan.summary.preservedExistingWork, 1);
});

test("従業員ごとの使用可能シフトを守る", () => {
  const plan = buildWorkShiftPlan({
    monthValue: "2026-07",
    employees: [employee("e1", 1, { allowedShiftCodes: ["L"] })],
    shiftTypes,
    shifts: { "2026-07": { e1: { "2026-07-01": "休" } } },
    shiftLocks: {},
    selectedShiftCodes: ["E", "M", "L"],
    mode: "empty-only"
  });
  assert.ok(plan.changes.length > 0);
  assert.equal(plan.changes.every((change) => change.after === "L"), true);
});

test("終了が遅い勤務の翌日は開始が早い勤務を避ける", () => {
  const plan = buildWorkShiftPlan({
    monthValue: "2026-07",
    employees: [employee("e1", 1, { allowedShiftCodes: ["E", "L"] })],
    shiftTypes,
    shifts: { "2026-07": { e1: { "2026-07-01": "L", "2026-07-03": "休" } } },
    shiftLocks: { "2026-07": { e1: { "2026-07-01": true } } },
    selectedShiftCodes: ["E", "L"],
    mode: "empty-only"
  });
  assert.equal(plan.changes.find((change) => change.day === 2)?.after, "L");
});

test("同じ日の時間帯とシフト種別が一方へ偏りにくい", () => {
  const plan = buildWorkShiftPlan({
    monthValue: "2026-07",
    employees: [
      employee("e1", 1, { allowedShiftCodes: ["E", "L"] }),
      employee("e2", 2, { allowedShiftCodes: ["E", "L"] })
    ],
    shiftTypes,
    shifts: {
      "2026-07": {
        e1: { "2026-07-02": "休" },
        e2: { "2026-07-02": "休" }
      }
    },
    shiftLocks: {},
    selectedShiftCodes: ["E", "L"],
    mode: "empty-only"
  });
  const firstDay = plan.changes.filter((change) => change.day === 1).map((change) => change.after);
  assert.deepEqual(new Set(firstDay), new Set(["E", "L"]));
});

test("残業がない候補を固定残業超過前に優先する", () => {
  const plan = buildWorkShiftPlan({
    monthValue: "2026-07",
    employees: [employee("e1", 1, { allowedShiftCodes: ["M", "L"], fixedOvertimeMinutes: 0 })],
    shiftTypes,
    shifts: { "2026-07": { e1: offDaysFrom(2) } },
    shiftLocks: {},
    selectedShiftCodes: ["M", "L"],
    mode: "empty-only"
  });
  assert.equal(plan.changes.find((change) => change.day === 1)?.after, "M");
  assert.equal(plan.summary.overtimeExceededEmployees, 0);
});

test("再割当モードは未ロック勤務だけを組み直す", () => {
  const plan = buildWorkShiftPlan({
    monthValue: "2026-07",
    employees: [employee("e1", 1, { allowedShiftCodes: ["M"], preferredShiftCode: "M" })],
    shiftTypes,
    shifts: {
      "2026-07": {
        e1: {
          "2026-07-01": "E",
          "2026-07-02": "E",
          "2026-07-03": "休"
        }
      }
    },
    shiftLocks: { "2026-07": { e1: { "2026-07-01": true } } },
    selectedShiftCodes: ["M"],
    mode: "replace-unlocked-work"
  });
  assert.equal(plan.changes.some((change) => change.day === 1), false);
  assert.equal(plan.changes.find((change) => change.day === 2)?.after, "M");
  assert.equal(plan.changes.some((change) => change.day === 3), false);
});
