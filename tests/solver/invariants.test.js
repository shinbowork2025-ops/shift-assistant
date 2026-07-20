import test from "node:test";
import assert from "node:assert/strict";
import {
  checkCompletePlanInvariants,
  checkRepairStateInvariants
} from "../../js/solver/invariants.js";
import { boardToEvaluationInput, loadBoard } from "./fixture-loader.js";

function input() {
  return boardToEvaluationInput(loadBoard("board-a.json"));
}

test("完成案のロック変更・未知コード・未割当を検出する", () => {
  const { plan, context } = input();
  const baseline = structuredClone(plan);
  plan.lockedCells.add("E1:0");
  plan.assignments[0][0] = "UNKNOWN";
  plan.assignments[1][0] = null;
  const result = checkCompletePlanInvariants(plan, baseline, context);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((item) => item.code === "lockedCellChanged"));
  assert.ok(result.failures.some((item) => item.code === "unknownShift"));
  assert.ok(result.failures.some((item) => item.code === "unassignedCell"));
});

test("修復途中は対象セルのnullだけを許し対象外変更を拒否する", () => {
  const { plan, context } = input();
  const baseline = structuredClone(plan);
  plan.assignments[0][0] = null;
  plan.assignments[1][0] = "S01";
  const result = checkRepairStateInvariants(plan, new Set(["E1:0"]), baseline, context);
  assert.equal(result.ok, false);
  assert.equal(result.failures.some((item) => item.code === "unassignedCell"), false);
  assert.ok(result.failures.some((item) => item.code === "unexpectedChange"));
});

test("不正な配列寸法をmalformedPlanとして返す", () => {
  const { plan, context } = input();
  const baseline = structuredClone(plan);
  plan.assignments[0].pop();
  const result = checkCompletePlanInvariants(plan, baseline, context);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].code, "malformedPlan");
});
