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

function totalBreakMinutes(items = []) {
  return items.reduce((sum, item) => sum + (Number(item.end) - Number(item.start)), 0);
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

test("locked break longer than the template does not add extra breaks", () => {
  // 拘束7時間（420分）は既定テンプレートが45分。利用者が60分をロックすると、
  // 同一長一致の実装では45分が別途追加され105分に膨らむ回帰を防ぐ。
  const locked = {
    type: "lunch",
    label: "lunch",
    start: 660,
    end: 720,
    target: 660,
    locked: true
  };
  const sevenHour = {
    id: "e1",
    name: "seven-hour",
    order: 1,
    shiftStart: 540,
    shiftEnd: 960,
    breaks: [locked]
  };
  const dayPlan = addGreedyInitialSolution({ employees: [sevenHour] });
  assert.equal(totalBreakMinutes(dayPlan.employees[0].breaks), 60);

  const result = optimizeBreaks(dayPlan, { seed: 42, restarts: 3 });
  assert.equal(result.hardCheck.ok, true, result.hardCheck.issues.join("\n"));
  assert.equal(totalBreakMinutes(result.breaks.e1), 60);
  const stillLocked = result.breaks.e1.find((item) => item.locked);
  assert.deepEqual(
    { start: stillLocked?.start, end: stillLocked?.end, locked: stillLocked?.locked },
    { start: 660, end: 720, locked: true }
  );
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
