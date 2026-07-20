import test from "node:test";
import assert from "node:assert/strict";
import {
  ADAPTIVE_STRATEGY_MIN_BLOCKS,
  FURTHER_STAGNATION_BLOCKS,
  LONG_STAGNATION_BLOCKS,
  MINIMUM_STRATEGY_SELECTION_RATE,
  RESTART_STAGNATION_BLOCKS,
  SHORT_STAGNATION_BLOCKS,
  adaptMonthSolverStrategyWeights,
  adaptiveStrategyEnabled,
  repairSizeForStagnation,
  restartStrategyWeights,
  strategyReward
} from "../js/month-solver-adaptation.js";
import { solveMonthSchedule } from "../js/month-solver.js";
import { restartSeed } from "../js/month-solver-control.js";

function neutralPlan() {
  return {
    monthValue: "2026-07",
    daysInMonth: 1,
    employees: [{
      id: "e1",
      name: "Employee",
      employmentType: "fulltime",
      fixedOvertimeMinutes: 0
    }],
    shiftTypes: [
      { code: "A", name: "A", start: "09:00", end: "17:00", isWork: true },
      { code: "B", name: "B", start: "09:00", end: "17:00", isWork: true }
    ],
    coverageRequirements: [],
    selectedEmployeeIds: ["e1"],
    selectedShiftCodes: ["A", "B"],
    assignments: { e1: { 1: "A" } },
    originalAssignments: { e1: { 1: "A" } },
    fixedValues: { e1: {} },
    allowedCodes: { e1: ["A", "B"] },
    targetDaysOffByEmployee: { e1: 0 },
    maxConsecutiveByEmployee: { e1: 6 },
    dominantCodeByEmployee: { e1: "A" },
    mutableCells: [{ employeeId: "e1", day: 1 }]
  };
}

function blockStatistics(overrides = {}) {
  const empty = {
    attempts: 100,
    validCandidates: 50,
    acceptedCandidates: 20,
    currentImprovements: 5,
    bestUpdates: 1,
    feasibleCandidates: 10
  };
  return {
    smallNeighbor: { ...empty, ...overrides.smallNeighbor },
    repair: { ...empty, ...overrides.repair },
    lns: { ...empty, ...overrides.lns }
  };
}

test("automatic strategy adjustment starts at fifty planned blocks", () => {
  assert.equal(ADAPTIVE_STRATEGY_MIN_BLOCKS, 50);
  assert.equal(MINIMUM_STRATEGY_SELECTION_RATE, 0.05);
  assert.equal(adaptiveStrategyEnabled(49), false);
  assert.equal(adaptiveStrategyEnabled(50), true);
  assert.equal(adaptiveStrategyEnabled(1, true), true);
  assert.equal(adaptiveStrategyEnabled(100, false), false);
});

test("reward-based updates stay normalized and keep every active strategy above five percent", () => {
  const statistics = blockStatistics({
    smallNeighbor: { bestUpdates: 20, currentImprovements: 40, feasibleCandidates: 40 },
    repair: { bestUpdates: 0, currentImprovements: 0, feasibleCandidates: 0 },
    lns: { bestUpdates: 0, currentImprovements: 1, feasibleCandidates: 0 }
  });
  assert.ok(strategyReward(statistics.smallNeighbor) > strategyReward(statistics.repair));
  const adjusted = adaptMonthSolverStrategyWeights(
    { smallNeighbor: 0.6, repair: 0.2, lns: 0.2 },
    statistics
  );
  assert.ok(Math.abs(Object.values(adjusted).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.ok(Object.values(adjusted).every((value) => value >= 0.05));
  assert.ok(adjusted.smallNeighbor > adjusted.repair);
});

test("stagnation expands repair regions through the four specified ranges", () => {
  assert.equal(SHORT_STAGNATION_BLOCKS, 2);
  assert.equal(LONG_STAGNATION_BLOCKS, 5);
  assert.equal(FURTHER_STAGNATION_BLOCKS, 9);
  assert.equal(RESTART_STAGNATION_BLOCKS, 10);
  assert.equal(repairSizeForStagnation(0, 0), 3);
  assert.equal(repairSizeForStagnation(2, 0), 6);
  assert.equal(repairSizeForStagnation(5, 0), 9);
  assert.equal(repairSizeForStagnation(9, 0), 13);
});

test("restart weights are deterministic, changed, normalized, and preserve disabled strategies", () => {
  const base = { smallNeighbor: 0.6, repair: 0.2, lns: 0.2 };
  const first = restartStrategyWeights(base, 1);
  assert.deepEqual(first, restartStrategyWeights(base, 1));
  assert.notDeepEqual(first, base);
  assert.ok(Math.abs(Object.values(first).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.equal(restartStrategyWeights({ smallNeighbor: 0.75, repair: 0.25, lns: 0 }, 2).lns, 0);
});

test("the integrated solver records adaptive metrics and timing without changing deterministic counters", () => {
  const run = () => solveMonthSchedule(neutralPlan(), {
    masterSeed: 20260720,
    iterations: 40,
    adaptiveStrategy: true,
    enableSearchRestart: false
  });
  const first = run();
  const second = run();
  assert.equal(first.adaptiveStrategyEnabled, true);
  assert.equal(first.strategyWeightHistory.length, 1);
  assert.ok(Object.values(first.strategyWeights).every((value) => value >= 0.05));
  for (const statistics of Object.values(first.statistics.strategies)) {
    assert.ok(Object.hasOwn(statistics, "currentImprovements"));
    assert.ok(Object.hasOwn(statistics, "bestUpdates"));
    assert.ok(Object.hasOwn(statistics, "feasibleCandidates"));
    assert.ok(Object.hasOwn(statistics, "averageChangedCells"));
  }
  for (const timing of Object.values(first.performanceStatistics.strategies)) {
    assert.ok(timing.averageProcessingTimeMs >= 0);
  }
  assert.deepEqual(first.statistics, second.statistics);
  assert.deepEqual(first.strategyWeightHistory, second.strategyWeightHistory);
});

test("a stagnant search restarts from the saved best plan with a deterministic seed", () => {
  const result = solveMonthSchedule(neutralPlan(), {
    masterSeed: 99,
    iterations: 2_001,
    adaptiveStrategy: false,
    restartStagnationBlocks: 1
  });
  assert.equal(result.searchRestarts, 1);
  assert.deepEqual(result.restartIterations, [2_000]);
  assert.deepEqual(result.restartSeeds, [restartSeed(99, 1)]);
  assert.equal(result.statistics.searchRestarts, 1);
  assert.equal(result.plan.assignments.e1[1], "A");
  const restart = result.strategyWeightHistory.find((entry) => entry.reason === "restart");
  assert.equal(restart.temperature, result.initialTemperature);
  assert.notDeepEqual(restart.weights, { smallNeighbor: 0.6, repair: 0.2, lns: 0.2 });
  assert.ok(result.statistics.consideredCandidates > 1);
});
