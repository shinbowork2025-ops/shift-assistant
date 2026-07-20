import test from "node:test";
import assert from "node:assert/strict";
import {
  EPOCH_ITERATIONS,
  FALLBACK_DETERIORATION_SCORE,
  TEMPERATURE_ACCEPT_PROBABILITY,
  YIELD_CHUNK_ITERATIONS,
  compareStatutoryVectors,
  decideCandidateAcceptance,
  normalizeExecutionConfig,
  restartSeed,
  temperatureFromPositiveDeltas
} from "../js/month-solver-control.js";
import {
  calibrateMonthSolverTemperature,
  solveMonthScheduleAsync
} from "../js/month-solver.js";
import { createMonthSolverNeighborSource } from "../js/month-solver-neighbors.js";
import { createMonthSolverScoreContext } from "../js/month-solver-score.js";
import {
  createEstimateMetrics,
  createSolverInputFingerprint,
  createSolverShiftChanges,
  createWorkerProgressMessage,
  createWorkerResultMessage
} from "../js/month-solver-worker-protocol.js";

function objective(scalar, statutoryViolationCount = 0, statutoryViolationAmount = 0) {
  return {
    scalar,
    vector: [0, 0, statutoryViolationAmount, 0, 0, 0],
    statutoryViolationCount,
    statutoryViolationAmount,
    shortagePeople: 0,
    internalViolationCount: 0
  };
}

function blockPlan() {
  const employees = [
    { id: "e1", name: "A", employmentType: "fulltime", fixedOvertimeMinutes: 0 },
    { id: "e2", name: "B", employmentType: "parttime", fixedOvertimeMinutes: 0 }
  ];
  return {
    monthValue: "2026-07",
    daysInMonth: 1,
    employees,
    shiftTypes: [
      { code: "E", name: "早", start: "09:00", end: "17:00", isWork: true, overtimeMinutes: 0 },
      { code: "L", name: "遅", start: "12:00", end: "20:00", isWork: true, overtimeMinutes: 0 }
    ],
    coverageRequirements: [
      { scope: "everyday", start: "09:00", end: "12:00", requiredTotal: 1, requiredByType: {} },
      { scope: "everyday", start: "17:00", end: "20:00", requiredTotal: 1, requiredByType: {} }
    ],
    selectedEmployeeIds: ["e1", "e2"],
    selectedShiftCodes: ["E", "L"],
    assignments: { e1: { 1: "L" }, e2: { 1: "L" } },
    originalAssignments: { e1: { 1: "L" }, e2: { 1: "L" } },
    fixedValues: { e1: {}, e2: {} },
    allowedCodes: { e1: ["E", "L"], e2: ["E", "L"] },
    targetDaysOffByEmployee: { e1: 0, e2: 0 },
    maxConsecutiveByEmployee: { e1: 6, e2: 6 },
    dominantCodeByEmployee: { e1: "L", e2: "L" },
    mutableCells: [{ employeeId: "e1", day: 1 }, { employeeId: "e2", day: 1 }]
  };
}

test("2,000反復ブロックと120反復yieldを既定値として固定する", () => {
  assert.equal(EPOCH_ITERATIONS, 2_000);
  assert.equal(YIELD_CHUNK_ITERATIONS, 120);
  assert.deepEqual(normalizeExecutionConfig({ fixedBlockCount: 3 }), {
    iterations: 6_000,
    fixedBlockCount: 3,
    plannedBlocks: 3,
    yieldChunkIterations: 120,
    timeBudgetMs: null
  });
});

test("正の差分30件以上は中央値、29件以下は2,000点で温度較正する", () => {
  const calibrated = temperatureFromPositiveDeltas(Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal(calibrated.medianPositiveDelta, 16);
  assert.equal(calibrated.fallbackUsed, false);
  assert.ok(Math.abs(calibrated.temperature - (16 / -Math.log(TEMPERATURE_ACCEPT_PROBABILITY))) < 1e-12);

  const fallback = temperatureFromPositiveDeltas(Array(29).fill(5));
  assert.equal(fallback.medianPositiveDelta, null);
  assert.equal(fallback.fallbackUsed, true);
  assert.ok(Math.abs(fallback.temperature
    - (FALLBACK_DETERIORATION_SCORE / -Math.log(TEMPERATURE_ACCEPT_PROBABILITY))) < 1e-12);
});

test("探索前温度較正は96候補を調べても盤面を変更しない", () => {
  const plan = blockPlan();
  const before = structuredClone(plan.assignments);
  const context = createMonthSolverScoreContext(plan);
  const source = createMonthSolverNeighborSource(plan);
  const calibration = calibrateMonthSolverTemperature(context, source, 20260720);
  assert.equal(calibration.sampledCandidates, 96);
  assert.deepEqual(plan.assignments, before);
  assert.deepEqual(context.plan.assignments, before);
});

test("法定ベクトルを単調非増加にし、法定改善でもスコア悪化は焼きなまし判定へ回す", () => {
  assert.equal(compareStatutoryVectors(objective(1, 1, 3), objective(1, 1, 2)), 1);
  const current = objective(100, 1, 2);
  const worsened = decideCandidateAcceptance({
    currentObjective: current,
    candidateObjective: objective(1, 2, 1),
    temperature: 1_000,
    random: () => 0
  });
  assert.deepEqual(worsened, { accepted: false, reason: "statutoryRatchet", probability: 0 });

  const improvedButExpensive = decideCandidateAcceptance({
    currentObjective: current,
    candidateObjective: objective(10_000, 0, 0),
    temperature: 1,
    random: () => 0.5
  });
  assert.equal(improvedButExpensive.accepted, false);
  assert.equal(improvedButExpensive.reason, "annealingRejected");

  const scalarImprovement = decideCandidateAcceptance({
    currentObjective: current,
    candidateObjective: objective(99, 1, 2),
    temperature: 1,
    random: () => 1
  });
  assert.equal(scalarImprovement.accepted, true);
  assert.equal(scalarImprovement.reason, "improved");

  const internalTemporaryIncrease = decideCandidateAcceptance({
    currentObjective: { ...objective(100), internalViolationCount: 0 },
    candidateObjective: { ...objective(101), internalViolationCount: 1 },
    temperature: 10_000,
    random: () => 0
  });
  assert.equal(internalTemporaryIncrease.accepted, true);
  assert.equal(internalTemporaryIncrease.reason, "annealing");
});

test("master seedと再スタート番号から決定的で重複しないseedを作る", () => {
  assert.equal(restartSeed("master", 1), restartSeed("master", 1));
  assert.notEqual(restartSeed("master", 1), restartSeed("master", 2));
  assert.notEqual(restartSeed("master", 1), restartSeed("other", 1));
});

test("固定ブロック数とseedが同じなら案・統計・ブロック進捗が一致する", async () => {
  const run = async () => {
    const progress = [];
    const result = await solveMonthScheduleAsync(blockPlan(), {
      masterSeed: 20260720,
      fixedBlockCount: 2
    }, { onProgress: (item) => progress.push(item) });
    return { result, progress };
  };
  const first = await run();
  const second = await run();
  assert.equal(first.result.iterations, 4_000);
  assert.equal(first.result.completedBlocks, 2);
  assert.equal(first.progress.length, 2);
  assert.deepEqual(first.progress.map((item) => item.completedBlocks), [1, 2]);
  assert.ok(first.progress[0].temperature > first.progress[1].temperature);
  assert.equal(first.progress[1].temperature, first.result.finalTemperature);
  assert.deepEqual(first.result.plan.assignments, second.result.plan.assignments);
  assert.deepEqual(first.result.objective, second.result.objective);
  assert.deepEqual(first.result.statistics, second.result.statistics);
  assert.deepEqual(first.progress, second.progress);
  assert.ok(compareStatutoryVectors(first.result.objective, first.result.initialObjective) <= 0);
});

test("fingerprint・差分・Workerメッセージをrevision付き形式で生成する", () => {
  const plan = blockPlan();
  const reordered = Object.fromEntries(Object.entries(structuredClone(plan)).reverse());
  assert.equal(createSolverInputFingerprint(plan), createSolverInputFingerprint(reordered));
  reordered.assignments.e1[1] = "E";
  assert.notEqual(createSolverInputFingerprint(plan), createSolverInputFingerprint(reordered));

  plan.assignments.e1[1] = "E";
  assert.deepEqual(createSolverShiftChanges(plan), [
    { employeeId: "e1", day: 1, before: "L", after: "E" }
  ]);
  const progress = createWorkerProgressMessage({ scheduleRevision: 7, inputFingerprint: "abc" }, {
    completedBlocks: 2,
    generatedCandidates: 3_900,
    acceptedCandidates: 800,
    bestEstimatedScore: 123,
    statutoryViolationCount: 0,
    internalViolationCount: 1,
    estimatedShortagePersonSlots: 2.5,
    temperature: 10
  });
  assert.equal(progress.scheduleRevision, 7);
  assert.equal(progress.completedBlocks, 2);
  assert.equal(Object.hasOwn(progress, "plan"), false);

  const message = createWorkerResultMessage(
    { scheduleRevision: 7, inputFingerprint: "abc" },
    {
      plan,
      objective: objective(123),
      statistics: { completedBlocks: 2 }
    },
    { fixedBlockCount: 2 }
  );
  assert.equal(message.type, "result");
  assert.equal(message.scheduleRevision, 7);
  assert.equal(message.shiftChanges.length, 1);
  assert.deepEqual(message.breakChanges, []);
  assert.deepEqual(message.manualBreakLockChanges, []);
  assert.equal(message.solverConfigSnapshot.fixedBlockCount, 2);
});

test("見込みと実測の過小・過大・最大・平均絶対誤差を相殺せず記録する", () => {
  assert.deepEqual(createEstimateMetrics([1, 0, 2], [2, 0.5, 1]), {
    estimatedShortagePersonSlots: 3,
    finalShortagePersonSlots: 3.5,
    underestimatedPersonSlots: 1.5,
    overestimatedPersonSlots: 1,
    maximumSlotUnderestimate: 1,
    maximumSlotOverestimate: 1,
    meanAbsoluteSlotError: 2.5 / 3
  });
});
