import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHIFT_TYPES } from "../js/shift-defaults.js";

test("デフォルトは実シフト01〜32と休日区分だけを持つ", () => {
  const codes = DEFAULT_SHIFT_TYPES.map((shiftType) => shiftType.code);
  const workCodes = DEFAULT_SHIFT_TYPES.filter((shiftType) => shiftType.isWork).map((shiftType) => shiftType.code);

  assert.deepEqual(workCodes, Array.from({ length: 32 }, (_, index) => String(index + 1).padStart(2, "0")));
  assert.equal(codes.includes("休"), true);
  assert.equal(DEFAULT_SHIFT_TYPES.find((shiftType) => shiftType.code === "休")?.name, "公休");
  assert.equal(codes.includes("7"), false);
  assert.equal(codes.includes("off"), false);
  assert.equal(codes.includes("early"), false);
  assert.equal(codes.includes("middle"), false);
  assert.equal(codes.includes("late"), false);
  assert.equal(codes.includes("short"), false);
});

test("勤務コード07と公休コード休を明確に区別する", () => {
  const work07 = DEFAULT_SHIFT_TYPES.find((shiftType) => shiftType.code === "07");
  const publicHoliday = DEFAULT_SHIFT_TYPES.find((shiftType) => shiftType.code === "休");

  assert.equal(work07?.isWork, true);
  assert.equal(work07?.start, "08:45");
  assert.equal(publicHoliday?.isWork, false);
  assert.equal(publicHoliday?.shortLabel, "休");
});
