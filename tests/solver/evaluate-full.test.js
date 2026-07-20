import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePlanFull } from "../../js/solver/evaluate-full.js";
import { SOLVER_CONFIG_VERSION } from "../../js/solver/solver-config.js";
import { boardToEvaluationInput, loadBoard } from "./fixture-loader.js";

function evaluateFixture(name, baselineName = "board-a.json") {
  const board = loadBoard(name);
  const baseline = loadBoard(baselineName);
  const input = boardToEvaluationInput(board, baseline);
  return { ...input, result: evaluatePlanFull(input.plan, input.context) };
}

test("盤面Aの全ペナルティが手計算値と一致する", () => {
  const { result } = evaluateFixture("board-a.json");
  assert.equal(result.solverConfigVersion, SOLVER_CONFIG_VERSION);
  assert.equal(result.statutoryPenalty, 0);
  assert.equal(result.internalPenalty, 4300);
  assert.equal(result.coveragePenalty, 0);
  assert.equal(result.overtimePenalty, 600);
  assert.equal(result.preferencePenalty, 50);
  assert.ok(Math.abs(result.fairnessPenalty - 34.4) < 1e-9);
  assert.equal(result.changePenalty, 0);
  assert.ok(Math.abs(result.score - 4984.4) < 1e-9);
  assert.equal(result.statutoryViolationCount, 0);
  assert.equal(result.internalViolationCount, 3);
});

test("盤面Bの法定休日不足・所定休日差・変更量を評価する", () => {
  const { result } = evaluateFixture("board-b.json");
  assert.equal(result.statutoryPenalty, 100_000);
  assert.equal(result.statutoryViolationCount, 1);
  assert.equal(result.statutoryViolationAmount, 1);
  assert.equal(result.internalPenalty, 6100);
  assert.equal(result.changePenalty, 1);
  assert.ok(Math.abs(result.fairnessPenalty - 48) < 1e-9);
  assert.ok(Math.abs(result.score - 106_799) < 1e-9);
});

test("盤面Cの小数不足を丸めずに評価する", () => {
  const { result } = evaluateFixture("board-c.json");
  assert.ok(Math.abs(result.estimatedShortageByScope.total - (590 / 429)) < 1e-9);
  assert.ok(Math.abs(result.coveragePenalty - (59_000 / 143)) < 1e-6);
  assert.ok(Math.abs(result.score - 5396.987412587413) < 1e-6);
});

test("盤面Dは見える範囲を過小評価せず境界未確認を分離する", () => {
  const { result } = evaluateFixture("board-d.json");
  assert.ok(Math.abs(result.score - 4984.4) < 1e-9);
  assert.deepEqual(
    result.verificationIssues.map((issue) => issue.type),
    ["prevBoundaryUnknown:consecutive", "prevBoundaryUnknown:restInterval"]
  );
});

test("scoreは7ペナルティの合計で、評価は純粋かつ決定的である", () => {
  const { plan, context } = boardToEvaluationInput(loadBoard("board-a.json"));
  const planBefore = structuredClone(plan);
  const contextBefore = structuredClone(context);
  const first = evaluatePlanFull(plan, context);
  const second = evaluatePlanFull(plan, context);
  assert.deepEqual(first, second);
  assert.deepEqual(plan, planBefore);
  assert.deepEqual(context, contextBefore);
  assert.equal(first.score, first.statutoryPenalty + first.internalPenalty + first.coveragePenalty
    + first.overtimePenalty + first.preferencePenalty + first.fairnessPenalty + first.changePenalty);
});
