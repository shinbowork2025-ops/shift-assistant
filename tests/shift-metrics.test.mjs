import test from "node:test";
import assert from "node:assert/strict";
import {
  shiftDurationMinutes,
  expectedBreakMinutes,
  paidMinutesForShift,
  breakMinutesWithinShift,
  overtimeMinutesForShift,
  formatDurationMinutes
} from "../js/shift-metrics.js";

const fullShift = {
  code: "early",
  name: "早番",
  start: "09:00",
  end: "18:00",
  isWork: true,
  overtimeMinutes: 60
};

test("通常9時間シフトの予定休憩と実働を計算する", () => {
  assert.equal(shiftDurationMinutes(fullShift), 540);
  assert.equal(expectedBreakMinutes(fullShift), 90);
  assert.equal(paidMinutesForShift(fullShift), 450);
  assert.equal(overtimeMinutesForShift(fullShift), 60);
});

test("重複と勤務時間外を除いて実休憩を計算する", () => {
  const breaks = [
    { start: "08:45", end: "09:15" },
    { start: "12:00", end: "13:00" },
    { start: "12:30", end: "13:30" },
    { start: "17:45", end: "18:15" }
  ];
  assert.equal(breakMinutesWithinShift(fullShift, breaks), 120);
  assert.equal(paidMinutesForShift(fullShift, { breaks }), 420);
});

test("固定実働の非勤務シフトと表示形式を維持する", () => {
  const paidLeave = { code: "paid", name: "有休", isWork: false, paidMinutes: 450 };
  assert.equal(paidMinutesForShift(paidLeave), 450);
  assert.equal(formatDurationMinutes(450), "7:30");
});
