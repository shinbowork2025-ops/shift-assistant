import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateEstimatedBreakLoad,
  clearBreakLoadProfileCache,
  estimatedBreakLoadProfile
} from "../../js/solver/break-load-profile.js";
import { evaluateEstimatedCoverageForDay } from "../../js/solver/coverage-evaluation.js";
import { evaluatePlanFull } from "../../js/solver/evaluate-full.js";
import { createIncrementalEvaluation } from "../../js/solver/incremental-evaluation.js";
import { normalizeSolverWeights } from "../../js/solver/solver-config.js";
import { boardToEvaluationInput, loadBoard } from "./fixture-loader.js";

const RESULT_NUMBERS = [
  "score",
  "statutoryPenalty",
  "internalPenalty",
  "coveragePenalty",
  "overtimePenalty",
  "preferencePenalty",
  "fairnessPenalty",
  "changePenalty",
  "statutoryViolationCount",
  "statutoryViolationAmount",
  "internalViolationCount",
  "internalViolationAmount",
  "preferenceViolationCount",
  "preferenceViolationAmount",
  "estimatedShortagePersonSlots"
];

function assertEvaluationEqual(actual, expected) {
  for (const key of RESULT_NUMBERS) {
    assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} !== ${expected[key]}`);
  }
  assert.deepEqual(actual.constraintLayers, expected.constraintLayers);
  assert.deepEqual(actual.estimatedShortageByScope, expected.estimatedShortageByScope);
  assert.deepEqual(actual.breakdownByEmployee, expected.breakdownByEmployee);
  assert.deepEqual(actual.verificationIssues, expected.verificationIssues);
  const normalizeViolations = (items) => items.map((item) => JSON.stringify(item)).sort();
  assert.deepEqual(normalizeViolations(actual.violations), normalizeViolations(expected.violations));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomChanges(plan, count, random) {
  const codes = ["S01", "S02", "S03", "OFF", "LEAVE"];
  const cells = [];
  for (let employee = 0; employee < plan.employeeOrder.length; employee += 1) {
    for (let day = 0; day < plan.dayCount; day += 1) cells.push({ employee, day });
  }
  const changes = [];
  while (changes.length < count && cells.length) {
    const cellIndex = Math.floor(random() * cells.length);
    const [{ employee, day }] = cells.splice(cellIndex, 1);
    const before = plan.assignments[employee][day];
    const alternatives = codes.filter((code) => code !== before);
    const after = alternatives[Math.floor(random() * alternatives.length)];
    changes.push({ employeeId: plan.employeeOrder[employee], day, before, after });
  }
  return changes;
}

test("盤面A〜Dの増分初期評価が全再計算と一致する", () => {
  for (const name of ["board-a.json", "board-b.json", "board-c.json", "board-d.json"]) {
    const input = boardToEvaluationInput(loadBoard(name), loadBoard("board-a.json"));
    const incremental = createIncrementalEvaluation(input.plan, input.context);
    assertEvaluationEqual(incremental.result, evaluatePlanFull(input.plan, input.context));
  }
});

test("固定シードの1・2・7・12セル変更で全再計算と一致する", () => {
  const input = boardToEvaluationInput(loadBoard("board-a.json"));
  const incremental = createIncrementalEvaluation(input.plan, input.context);
  const random = seededRandom(20260720);
  for (const count of [1, 2, 7, 12]) {
    const changes = randomChanges(incremental.plan, count, random);
    const result = incremental.applyChanges(changes);
    const full = evaluatePlanFull(incremental.plan, input.context);
    assertEvaluationEqual(result, full);
    assert.deepEqual(
      incremental.lastUpdate.employeeIds,
      [...new Set(changes.map((change) => change.employeeId))]
        .sort((left, right) => incremental.plan.employeeOrder.indexOf(left) - incremental.plan.employeeOrder.indexOf(right))
    );
    assert.deepEqual(
      incremental.lastUpdate.days,
      [...new Set(changes.map((change) => change.day))].sort((left, right) => left - right)
    );
  }
});

test("変更日の休憩負荷配列だけを更新し全再構築値と一致する", () => {
  const input = boardToEvaluationInput(loadBoard("board-a.json"));
  const incremental = createIncrementalEvaluation(input.plan, input.context);
  incremental.applyChanges([
    { employeeId: "E1", day: 0, before: "S01", after: "S02" },
    { employeeId: "E2", day: 3, before: "S03", after: "S01" }
  ]);
  const weights = normalizeSolverWeights(input.context.settings.weights);
  for (const day of incremental.lastUpdate.days) {
    const rebuilt = evaluateEstimatedCoverageForDay(
      incremental.plan,
      day,
      input.context,
      weights,
      { includeCoverageDetails: true }
    );
    const cached = incremental.dayMetrics.get(day);
    assert.deepEqual([...cached.rawCoverage.total], [...rebuilt.rawCoverage.total]);
    assert.deepEqual([...cached.breakLoad.total], [...rebuilt.breakLoad.total]);
    assert.deepEqual(cached.estimatedShortageByScope, rebuilt.estimatedShortageByScope);
  }
});

test("完全配置候補プロファイルを属性別へ同じperson-slot量で反映する", () => {
  clearBreakLoadProfileCache();
  const board = loadBoard("board-a.json");
  const shift = board.shiftTypes.find((item) => item.code === "S01");
  const employee = board.employees.find((item) => item.id === "E1");
  const profile = estimatedBreakLoadProfile(shift, shift.breakPolicy, board.settings.breakConstraints);
  const load = aggregateEstimatedBreakLoad([
    { employee, shiftType: shift }
  ], { breakConstraints: board.settings.breakConstraints });
  assert.deepEqual([...load.total], [...profile]);
  assert.deepEqual([...load.byEmploymentType.get("社員")], [...profile]);
  assert.deepEqual([...load.byDepartment.get("園芸")], [...profile]);
  assert.deepEqual([...load.byQualification.get("レジ")], [...profile]);
  assert.ok(Math.abs(load.total.reduce((sum, value) => sum + value, 0) - 6) < 1e-9);
});

test("手動固定休憩を確定負荷として全再計算と増分評価へ反映する", () => {
  const input = boardToEvaluationInput(loadBoard("board-c.json"), loadBoard("board-a.json"));
  input.context.fixedBreaks = {
    0: {
      E1: [{ type: "lunch", startMinute: 12 * 60, endMinute: 13 * 60 }]
    }
  };
  const incremental = createIncrementalEvaluation(input.plan, input.context);
  const full = evaluatePlanFull(input.plan, input.context);
  assertEvaluationEqual(incremental.result, full);
  const day = incremental.dayMetrics.get(0);
  for (let slot = 48; slot < 52; slot += 1) assert.equal(day.breakLoad.total[slot] >= 1, true);

  const result = incremental.applyChanges([
    { employeeId: "E2", day: 0, before: "S03", after: "S01" }
  ]);
  assertEvaluationEqual(result, evaluatePlanFull(incremental.plan, input.context));
});

test("変更前値が一致しない差分を拒否して盤面を変更しない", () => {
  const input = boardToEvaluationInput(loadBoard("board-a.json"));
  const incremental = createIncrementalEvaluation(input.plan, input.context);
  const before = structuredClone(incremental.plan);
  assert.throws(() => incremental.applyChanges([
    { employeeId: "E1", day: 0, before: "S02", after: "OFF" }
  ]), /変更前値が一致しません/);
  assert.deepEqual(incremental.plan, before);
});
