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
  assert.equal(result.preferenceViolationCount, 1);
  assert.deepEqual(result.constraintLayers, {
    statutory: { violationCount: 0, violationAmount: 0, penalty: 0 },
    internal: { violationCount: 3, violationAmount: 4, penalty: 4300 },
    preference: { violationCount: 1, violationAmount: 1, penalty: 50 }
  });
  assert.deepEqual(
    result.violations.filter((violation) => violation.layer === "preference").map((violation) => violation.type),
    ["missedDayOffRequest"]
  );
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
  assert.ok(Math.abs(result.estimatedShortageByScope.total - (2236 / 1695)) < 1e-9);
  assert.ok(Math.abs(result.coveragePenalty - (44_720 / 113)) < 1e-6);
  assert.ok(Math.abs(result.score - 5380.152212389381) < 1e-6);
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

test("期間外を含む法定休日周期は境界既知フラグだけで違反認定しない", () => {
  const plan = {
    periodStart: "2026-07-01",
    dayCount: 1,
    employeeOrder: ["E1"],
    assignments: [["WORK"]],
    lockedCells: new Set()
  };
  const context = {
    shiftTypes: new Map([
      ["WORK", { code: "WORK", isDayOff: false, startMinutes: 540, endMinutes: 1020, overtimeMinutes: 0 }],
      ["OFF", { code: "OFF", isDayOff: true, overtimeMinutes: 0 }]
    ]),
    employees: new Map([["E1", { id: "E1", name: "E1", targetDaysOff: 0 }]]),
    settings: {
      statutoryHolidayRule: "weekly",
      weekStartDay: 1,
      statutoryHolidayCodes: ["OFF"],
      previousBoundaryKnown: true,
      nextBoundaryKnown: true,
      restMinimumMinutes: 660,
      maxConsecutiveWorkDays: 6
    },
    requirements: [],
    preferences: []
  };

  const result = evaluatePlanFull(plan, context);
  assert.equal(result.statutoryViolationCount, 0);
  assert.ok(result.verificationIssues.some((issue) => issue.type === "statutoryCycleIncomplete"));
});
