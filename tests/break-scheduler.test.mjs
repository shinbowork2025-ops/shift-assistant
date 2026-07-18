import test from "node:test";
import assert from "node:assert/strict";
import { BREAK_SLOT_MINUTES, scheduleBreaks } from "../js/break-scheduler.js";
import { breaksFitShiftWindow, plannedBreakTemplates, validateBreaks } from "../js/break-rules.js";
import { minutesToTime } from "../js/date-time.js";

const MINUTE = { h9: 9 * 60, h15: 15 * 60, h18: 18 * 60 };

function assignment(id, shiftStart, shiftEnd, overrides = {}) {
  return {
    id,
    shiftStart,
    shiftEnd,
    movable: true,
    templates: plannedBreakTemplates(shiftEnd - shiftStart),
    existingBreaks: [],
    ...overrides
  };
}

function coverageAt(assignments, placements, slot) {
  let active = 0;
  let onBreak = 0;
  for (const item of assignments) {
    if (slot < item.shiftStart || slot >= item.shiftEnd) continue;
    active += 1;
    const breaks = item.movable
      ? placements.get(item.id)
      : (item.existingBreaks ?? []).map((b) => ({ startMinute: b.startMinute, endMinute: b.endMinute }));
    if ((breaks ?? []).some((b) => slot >= b.startMinute && slot < b.endMinute)) onBreak += 1;
  }
  return { active, coverage: active - onBreak };
}

function allSlots(assignments) {
  const start = Math.min(...assignments.map((a) => a.shiftStart));
  const end = Math.max(...assignments.map((a) => a.shiftEnd));
  const slots = [];
  for (let slot = Math.floor(start / BREAK_SLOT_MINUTES) * BREAK_SLOT_MINUTES; slot < end; slot += BREAK_SLOT_MINUTES) {
    slots.push(slot);
  }
  return slots;
}

test("単独勤務でも制約内の位置に休憩を配置する", () => {
  const input = [assignment("e1", MINUTE.h9, MINUTE.h18)];
  const placements = scheduleBreaks(input);
  const breaks = placements.get("e1");

  assert.equal(breaks.length, 3);
  // 休憩は始業60分後以降・終業60分前まで、休憩同士は60分以上空く。
  let previousEnd = MINUTE.h9;
  for (const breakItem of breaks) {
    assert.ok(breakItem.startMinute >= previousEnd + 60, "休憩間隔が60分未満です");
    assert.equal(breakItem.startMinute % BREAK_SLOT_MINUTES, 0, "15分グリッドに整列していません");
    previousEnd = breakItem.endMinute;
  }
  assert.ok(breaks.at(-1).endMinute <= MINUTE.h18 - 60, "終業前1時間以内に休憩があります");
});

test("短時間・中時間・長時間シフトの休憩を始業後と終業前の1時間へ入れない", () => {
  const input = [
    assignment("short", MINUTE.h9, 13 * 60 + 15),
    assignment("middle", MINUTE.h9, MINUTE.h15),
    assignment("long", MINUTE.h9, MINUTE.h18)
  ];
  const placements = scheduleBreaks(input);

  for (const item of input) {
    for (const breakItem of placements.get(item.id) ?? []) {
      assert.ok(breakItem.startMinute >= item.shiftStart + 60, `${item.id}の休憩が始業後1時間以内です`);
      assert.ok(breakItem.endMinute <= item.shiftEnd - 60, `${item.id}の休憩が終業前1時間以内です`);
    }
  }
});

test("同一シフト2人の昼休憩をずらして実配置0を避ける", () => {
  const input = [
    assignment("e1", MINUTE.h9, MINUTE.h15),
    assignment("e2", MINUTE.h9, MINUTE.h15)
  ];
  const placements = scheduleBreaks(input);

  for (const slot of allSlots(input)) {
    const { active, coverage } = coverageAt(input, placements, slot);
    if (active === 2) {
      assert.ok(coverage >= 1, `${slot}分時点で実配置が${coverage}人になっています`);
    }
  }
});

test("9時間勤務3人でも全時間帯で実配置1人以上を維持する", () => {
  const input = [
    assignment("e1", MINUTE.h9, MINUTE.h18),
    assignment("e2", MINUTE.h9, MINUTE.h18),
    assignment("e3", MINUTE.h9, MINUTE.h18)
  ];
  const placements = scheduleBreaks(input);

  let minimum = Number.POSITIVE_INFINITY;
  for (const slot of allSlots(input)) {
    const { coverage } = coverageAt(input, placements, slot);
    minimum = Math.min(minimum, coverage);
  }
  assert.ok(minimum >= 1, `最小実配置が${minimum}人です`);
});

test("固定された既存休憩を避けて配置する", () => {
  // e2の昼休憩は12:00-12:45で固定。e1（同一シフト）は同時に休憩すると
  // 実配置が0になるため、別の時間帯を選ぶはず。
  const input = [
    assignment("e1", MINUTE.h9, MINUTE.h15),
    assignment("e2", MINUTE.h9, MINUTE.h15, {
      movable: false,
      templates: [],
      existingBreaks: [{ startMinute: 12 * 60, endMinute: 12 * 60 + 45 }]
    })
  ];
  const placements = scheduleBreaks(input);
  const lunch = placements.get("e1").find((b) => b.type === "lunch");

  const overlaps = lunch.startMinute < 12 * 60 + 45 && lunch.endMinute > 12 * 60;
  assert.equal(overlaps, false, "固定休憩と重なっています");
  assert.equal(placements.has("e2"), false, "固定対象の休憩を生成してはいけません");
});

test("同じ入力からは常に同じ配置を返す", () => {
  const input = () => [
    assignment("e1", MINUTE.h9, MINUTE.h18),
    assignment("e2", 10 * 60, 16 * 60),
    assignment("e3", 12 * 60, MINUTE.h18)
  ];
  const first = scheduleBreaks(input());
  const second = scheduleBreaks(input());
  assert.deepEqual([...first.entries()], [...second.entries()]);
});

test("5時間超の短いシフトにも昼休憩が入る", () => {
  const input = [assignment("e1", MINUTE.h9, MINUTE.h15)];
  const placements = scheduleBreaks(input);
  const breaks = placements.get("e1");

  assert.equal(breaks.length, 1);
  assert.equal(breaks[0].type, "lunch");
  assert.equal(breaks[0].endMinute - breaks[0].startMinute, 45);
});

test("固定休憩に強く圧迫されても勤務枠外や禁止帯へ配置しない", () => {
  const input = [
    assignment("A", MINUTE.h9, MINUTE.h18),
    assignment("B", MINUTE.h9, MINUTE.h18, {
      movable: false,
      templates: [],
      existingBreaks: [{ startMinute: 10 * 60, endMinute: 16 * 60 }]
    })
  ];
  const placements = scheduleBreaks(input).get("A");
  const shiftType = { isWork: true, start: "09:00", end: "18:00" };
  const formatted = placements.map((item) => ({
    start: minutesToTime(item.startMinute),
    end: minutesToTime(item.endMinute)
  }));

  assert.equal(breaksFitShiftWindow(shiftType, formatted), true);
  assert.equal(validateBreaks(shiftType, formatted).ok, true);
  assert.ok(placements.every((item) => item.startMinute >= 10 * 60));
  assert.ok(placements.every((item) => item.endMinute <= 17 * 60));
});

test("可行域がないテンプレートは違法配置せず未配置にする", () => {
  const placements = scheduleBreaks([assignment("A", 9 * 60, 10 * 60, {
    templates: [{ type: "lunch", label: "昼休憩", duration: 90, targetOffset: 0 }]
  })]).get("A");
  assert.deepEqual(placements, []);
});
