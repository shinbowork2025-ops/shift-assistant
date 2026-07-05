import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { buildInitialMonthPlan } from "../js/month-plan-builder.js";
import { optimizeMonthSchedule, optimizeMonthScheduleAsync } from "../js/month-optimizer.js";
import { checkHardMonth, scoreMonth } from "../js/scoringMonth.js";

async function fixture() {
  return JSON.parse(await readFile(new URL("../js/fixtures/month-01-requests-15.json", import.meta.url), "utf8"));
}

function requiredCoverage(monthValue) {
  const result = {};
  for (let day = 1; day <= 31; day += 1) {
    const slots = Array(96).fill(0);
    for (let slot = 28; slot < 80; slot += 1) slots[slot] = 4;
    result[`${monthValue}-${String(day).padStart(2, "0")}`] = slots;
  }
  return result;
}

async function initialPlan() {
  const data = await fixture();
  return buildInitialMonthPlan({
    ...data,
    selectedEmployeeIds: data.employees.map((employee) => employee.id),
    selectedWorkShiftCodes: ["A", "B", "C"]
  });
}

const searchConfig = {
  seed: 24680,
  iterations: 1600,
  requiredCoverageByDate: requiredCoverage("2026-07"),
  monthWeights: {
    daysOffDeviation: 220,
    maxConsecutiveExcess: 2200,
    overtimeExcess: 0.4,
    shortRest: 4500,
    weekendFairness: 45,
    lateShiftFairness: 45
  }
};

test("同一入力と同一シードで月間案が完全一致する", async () => {
  const plan = await initialPlan();
  const first = optimizeMonthSchedule(plan, searchConfig);
  const second = optimizeMonthSchedule(plan, searchConfig);
  assert.equal(first.score, second.score);
  assert.deepEqual(first.plan.assignments, second.plan.assignments);
  assert.deepEqual(first.breakdown, second.breakdown);
});

test("希望休と事前入力済みセルを変更せず、初期案より悪化しない", async () => {
  const plan = await initialPlan();
  const initial = scoreMonth(plan, searchConfig);
  const result = optimizeMonthSchedule(plan, searchConfig);

  assert.ok(result.score <= initial.total);
  assert.equal(result.plan.assignments.e01[1], "A");
  assert.equal(result.plan.assignments.e02[1], "B");
  assert.equal(result.plan.assignments.e03[1], "C");
  assert.equal(result.plan.assignments.e01[5], "休");
  assert.equal(result.plan.assignments.e01[19], "休");
  assert.equal(result.plan.assignments.e05[9], "休");
  assert.equal(result.hardCheck.ok, true, result.hardCheck.issues.join("\n"));
  assert.equal(checkHardMonth(result.plan, searchConfig).ok, true);
});

test("中断要求でも常に有効な最良案を返す", async () => {
  const plan = await initialPlan();
  let progressCount = 0;
  const result = await optimizeMonthScheduleAsync(plan, {
    ...searchConfig,
    iterations: 5000,
    chunkSize: 100,
    progressEvery: 100
  }, {
    onProgress: () => { progressCount += 1; },
    shouldStop: () => progressCount >= 2
  });
  assert.equal(result.stopped, true);
  assert.equal(result.hardCheck.ok, true, result.hardCheck.issues.join("\n"));
  assert.ok(result.iterations < 5000);
});

test("15人×31日を10秒以内で実用的な案へ改善する", async (context) => {
  const plan = await initialPlan();
  const started = performance.now();
  const result = optimizeMonthSchedule(plan, {
    ...searchConfig,
    iterations: 4000
  });
  const elapsed = performance.now() - started;
  context.diagnostic(`4000 iterations: ${elapsed.toFixed(1)}ms, ${result.initialScore.toFixed(0)} -> ${result.score.toFixed(0)}`);
  assert.ok(elapsed < 10_000, `elapsed ${elapsed.toFixed(1)}ms`);
  assert.equal(result.hardCheck.ok, true, result.hardCheck.issues.join("\n"));
  assert.ok(result.score <= result.initialScore);
});
