import test from "node:test";
import assert from "node:assert/strict";
import { moveBreakToStart } from "../js/break-drag.js";

const shiftType = { code: "M", name: "日勤", start: "09:00", end: "17:00", isWork: true };

test("休憩を同じ長さのまま15分単位で移動する", () => {
  const result = moveBreakToStart({
    breaks: [{ type: "lunch", label: "昼休憩", start: "12:00", end: "12:45" }],
    breakIndex: 0,
    newStartMinute: 13 * 60 + 7,
    shiftType
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.breaks, [
    { type: "lunch", label: "昼休憩", start: "13:00", end: "13:45" }
  ]);
});

test("勤務時間外へは移動しない", () => {
  const result = moveBreakToStart({
    breaks: [{ type: "lunch", label: "昼休憩", start: "12:00", end: "12:45" }],
    breakIndex: 0,
    newStartMinute: 16 * 60 + 30,
    shiftType
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /勤務時間内/);
});

test("他の休憩と重なる位置へは移動しない", () => {
  const result = moveBreakToStart({
    breaks: [
      { type: "small", label: "小休憩", start: "10:00", end: "10:15" },
      { type: "lunch", label: "昼休憩", start: "12:00", end: "12:45" }
    ],
    breakIndex: 0,
    newStartMinute: 12 * 60 + 30,
    shiftType
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /重ならない/);
});
