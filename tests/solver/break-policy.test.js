import test from "node:test";
import assert from "node:assert/strict";
import { validateBreakPolicyForShift } from "../../js/solver/break-policy.js";
import {
  breakLoadProfileCache,
  clearBreakLoadProfileCache,
  estimatedBreakLoadProfile
} from "../../js/solver/break-load-profile.js";
import {
  overtimeMinutes,
  payableMinutes,
  plannedBreakMinutes,
  scheduledWorkMinutes,
  spanMinutes
} from "../../js/solver/time-slots.js";
import { loadBoard } from "./fixture-loader.js";

const board = loadBoard("board-a.json");
const shifts = new Map(board.shiftTypes.map((shiftType) => [shiftType.code, shiftType]));

test("時間値を拘束・休憩・実働・支給対象へ分離する", () => {
  const shift = shifts.get("S01");
  assert.equal(spanMinutes(shift), 540);
  assert.equal(plannedBreakMinutes(shift), 90);
  assert.equal(scheduledWorkMinutes(shift), 450);
  assert.equal(payableMinutes(shift), 450);
  assert.equal(payableMinutes({ ...shift, paidMinutes: 480 }), 480);
  assert.equal(payableMinutes({ ...shift, paidMinutes: undefined }), 450);
  assert.equal(overtimeMinutes(shift), 60);
  assert.equal(spanMinutes(shifts.get("OFF")), 0);
  assert.equal(overtimeMinutes(shifts.get("OFF")), 0);
});

test("休憩方針を検証し、決定的な完全配置を返す", () => {
  const shift = shifts.get("S01");
  const first = validateBreakPolicyForShift(shift, shift.breakPolicy, board.settings.breakConstraints);
  const second = validateBreakPolicyForShift(shift, shift.breakPolicy, board.settings.breakConstraints);
  assert.equal(first.ok, true);
  assert.deepEqual(first.samplePlacement, second.samplePlacement);
  assert.deepEqual(first.samplePlacement, [660, 810, 960]);
});

test("法定下限不足と完全配置不能をすべて報告する", () => {
  const shift = shifts.get("S01");
  const insufficient = validateBreakPolicyForShift(shift, {
    totalMinutes: 15,
    segments: [{ type: "small", duration: 15, targetOffset: 120 }]
  }, board.settings.breakConstraints);
  assert.equal(insufficient.ok, false);
  assert.match(insufficient.issues.join(" / "), /下限60分/);
  assert.equal(insufficient.issues.filter((issue) => /下限(45|60)分/.test(issue)).length, 1);

  const shortShift = shifts.get("S03");
  const impossible = validateBreakPolicyForShift(shortShift, shortShift.breakPolicy, {
    ...board.settings.breakConstraints,
    forbiddenStartMinutes: 150,
    forbiddenEndMinutes: 150
  });
  assert.equal(impossible.ok, false);
  assert.match(impossible.issues.join(" / "), /配置できません/);
});

test("完全配置候補の休憩負荷プロファイルがperson-slot手計算値と一致する", () => {
  clearBreakLoadProfileCache();
  const s01 = estimatedBreakLoadProfile(shifts.get("S01"), board.settings.breakConstraints);
  assert.ok(Math.abs(s01.reduce((sum, value) => sum + value, 0) - 6) < 1e-9);
  assert.ok(Math.abs(s01[42] - (75 / 565)) < 1e-9);
  assert.ok(Math.abs(s01[48] - (68 / 565)) < 1e-9);
  assert.ok(Math.abs(s01[51] - (213 / 565)) < 1e-9);
  assert.equal(s01[36], 0);
  assert.equal(s01[71], 0);

  const s03 = estimatedBreakLoadProfile(shifts.get("S03"), board.settings.breakConstraints);
  assert.ok(Math.abs(s03.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
  for (let slot = 48; slot <= 51; slot += 1) assert.ok(Math.abs(s03[slot] - (1 / 12)) < 1e-9);

  const s02 = estimatedBreakLoadProfile(shifts.get("S02"), board.settings.breakConstraints);
  for (let slot = 48; slot <= 51; slot += 1) assert.equal(s02[slot], 0);

  const reused = estimatedBreakLoadProfile(shifts.get("S01"), board.settings.breakConstraints);
  assert.equal(reused, s01);
  assert.equal(breakLoadProfileCache.size, 3);
});
