import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { addGreedyInitialSolution } from "../js/optimizer-data.js";
import { optimizeBreaks } from "../js/optimizer.js";

function employee(index, breaks = []) {
  return {
    id: `e${index + 1}`,
    name: `employee-${index + 1}`,
    order: index + 1,
    shiftStart: 540,
    shiftEnd: 1080,
    breaks
  };
}

test("locked rest remains unchanged", () => {
  const locked = {
    type: "lunch",
    label: "lunch",
    start: 720,
    end: 780,
    target: 720,
    locked: true
  };
  const dayPlan = addGreedyInitialSolution({ employees: [employee(0, [locked]), employee(1)] });
  const result = optimizeBreaks(dayPlan, { seed: 505, restarts: 3 });
  const actual = result.breaks.e1.find((item) => item.locked);
  assert.deepEqual(actual, locked);
});

test("thirty employees complete within one second", () => {
  const dayPlan = addGreedyInitialSolution({
    employees: Array.from({ length: 30 }, (_, index) => employee(index))
  });
  const startedAt = performance.now();
  const result = optimizeBreaks(dayPlan, { seed: 777, restarts: 3 });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(result.hardCheck.ok, true, result.hardCheck.issues.join("\n"));
  assert.ok(elapsedMs < 1000, `elapsed=${elapsedMs.toFixed(1)}ms`);
});
