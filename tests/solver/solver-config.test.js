import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SOLVER_WEIGHTS,
  SOLVER_CONFIG_VERSION,
  normalizeSolverWeights
} from "../../js/solver/solver-config.js";
import { normalizeShiftType } from "../../js/workspace-normalizer.js";
import { prepareMasterImport } from "../../js/csv.js";
import { state } from "../../js/model.js";

test("設定版と既定重みを固定する", () => {
  assert.equal(SOLVER_CONFIG_VERSION, 5);
  assert.equal(DEFAULT_SOLVER_WEIGHTS.statutoryHolidayDeficitDay, 100_000);
  assert.equal(DEFAULT_SOLVER_WEIGHTS.shortagePersonSlot.department, 200);
});

test("旧数値形式の複合重みを入れ子形式へ展開する", () => {
  const weights = normalizeSolverWeights({ daysOffDeviationDay: 77, shortagePersonSlot: 12 });
  assert.deepEqual(weights.daysOffDeviationDay, { deficit: 77, excess: 77 });
  assert.deepEqual(weights.shortagePersonSlot, {
    total: 12,
    qualification: 12,
    department: 12,
    employmentType: 12
  });
});

test("シフト読込時に休憩方針を補完・検証する", () => {
  const valid = normalizeShiftType({
    code: "S01", name: "早番", start: "09:00", end: "18:00", isWork: true
  }, 0);
  assert.equal(valid.breakPolicyValid, true);
  assert.equal(valid.breakPolicy.totalMinutes, 90);

  const invalid = normalizeShiftType({
    code: "BAD",
    name: "不正",
    start: "09:00",
    end: "18:00",
    isWork: true,
    breakPolicy: { totalMinutes: 15, segments: [{ type: "small", duration: 15, targetOffset: 120 }] }
  }, 0);
  assert.equal(invalid.breakPolicyValid, false);
  assert.match(invalid.breakPolicyIssues.join(" / "), /下限60分/);
});

test("休憩設定エラーのマスター取込は成功扱いのままソルバー禁止状態を保持する", () => {
  const originalShiftTypes = state.shiftTypes;
  try {
    state.shiftTypes = [normalizeShiftType({
      code: "BAD",
      name: "不正",
      shortLabel: "BAD",
      start: "09:00",
      end: "18:00",
      isWork: true,
      breakPolicy: { totalMinutes: 15, segments: [{ type: "small", duration: 15, targetOffset: 120 }] }
    }, 0)];
    const plan = prepareMasterImport([
      ["種別", "コード", "名称", "開始時刻", "終了時刻"],
      ["シフト", "BAD", "不正", "09:00", "18:00"]
    ]);
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.summary.breakPolicyErrors.length, 1);
    assert.equal(plan.operations[0].action, "unchanged");
    assert.equal(plan.operations[0].changes.breakPolicyValid, false);
  } finally {
    state.shiftTypes = originalShiftTypes;
  }
});
