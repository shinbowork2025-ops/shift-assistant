import test from "node:test";
import assert from "node:assert/strict";
import { validateMonthReadiness } from "../js/month-validation.js";

const employee = {
  id: "employee-1",
  name: "田中",
  fixedOvertimeMinutes: 0,
  restPatternId: "default"
};

const shiftTypes = [
  { code: "休", name: "公休", isWork: false },
  { code: "早", name: "早番", isWork: true, start: "08:00", end: "17:00", paidMinutes: 480, overtimeMinutes: 0 }
];

function monthAssignments(monthValue, code, days = 31) {
  const values = {};
  for (let day = 1; day <= days; day += 1) {
    values[`${monthValue}-${String(day).padStart(2, "0")}`] = code;
  }
  return values;
}

function completeBoundaryShifts(currentAssignments) {
  return {
    "2026-06": { [employee.id]: monthAssignments("2026-06", "休", 30) },
    "2026-07": { [employee.id]: currentAssignments },
    "2026-08": { [employee.id]: monthAssignments("2026-08", "休", 31) }
  };
}

test("隣接月が未登録ならエラーがなくても検証OKにしない", () => {
  const result = validateMonthReadiness({
    monthValue: "2026-07",
    employees: [employee],
    shiftTypes,
    shifts: { "2026-07": { [employee.id]: monthAssignments("2026-07", "休", 31) } }
  });

  assert.equal(result.blockingCount, 0);
  assert.equal(result.blankCount, 0);
  assert.equal(result.unverifiedCount, 1);
  assert.equal(result.ready, false);
  assert.match(result.issues.find((item) => item.category === "boundary")?.message ?? "", /月境界を完全には判定できません/);
});

test("固定実働と配置済み休憩からの実働が異なる場合は未確認にする", () => {
  const current = monthAssignments("2026-07", "休", 31);
  current["2026-07-01"] = "早";
  const result = validateMonthReadiness({
    monthValue: "2026-07",
    employees: [employee],
    shiftTypes,
    shifts: completeBoundaryShifts(current),
    breaks: {
      "2026-07-01": {
        [employee.id]: [{ start: "12:00", end: "13:30" }]
      }
    }
  });

  const paidIssue = result.issues.find((item) => item.category === "paid-minutes");
  assert.ok(paidIssue);
  assert.match(paidIssue.message, /固定実働480分/);
  assert.match(paidIssue.message, /計算値450分/);
  assert.equal(result.unverifiedCount, 1);
  assert.equal(result.ready, false);
});

test("月境界が既知で固定実働と計算値が一致すれば未確認はない", () => {
  const current = monthAssignments("2026-07", "休", 31);
  current["2026-07-01"] = "早";
  const result = validateMonthReadiness({
    monthValue: "2026-07",
    employees: [employee],
    shiftTypes,
    shifts: completeBoundaryShifts(current),
    breaks: {
      "2026-07-01": {
        [employee.id]: [{ start: "12:00", end: "13:00" }]
      }
    }
  });

  assert.equal(result.unverifiedCount, 0);
  assert.equal(result.blockingCount, 0);
  assert.equal(result.blankCount, 0);
  assert.equal(result.ready, true);
});
