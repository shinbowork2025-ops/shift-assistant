import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timeToMinutes } from "../js/date-time.js";
import { plannedBreakTemplates } from "../js/break-rules.js";
import { createGreedyBreaks, optimizeBreaks } from "../js/optimizer.js";
import { checkHard, canonicalBreaks } from "../js/scoring.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = path.join(repositoryRoot, "js", "fixtures");
const fixtureConfig = {
  seed: 424242,
  restarts: 3,
  maxSweeps: 6,
  maxPatternsPerEmployee: 8
};

function toMinuteBreaks(breaks = []) {
  return breaks.map((breakItem) => ({
    type: breakItem.type,
    label: breakItem.label,
    locked: breakItem.locked === true,
    startMinute: timeToMinutes(breakItem.start),
    endMinute: timeToMinutes(breakItem.end)
  }));
}

function fixtureToDayPlan(fixture) {
  return {
    employees: fixture.employees.map((employee) => {
      const shiftStartMinute = timeToMinutes(employee.shiftStart);
      const shiftEndMinute = timeToMinutes(employee.shiftEnd);
      const span = shiftEndMinute - shiftStartMinute;
      return {
        id: employee.id,
        name: employee.name,
        order: Number(employee.order ?? 0),
        shiftStartMinute,
        shiftEndMinute,
        templates: plannedBreakTemplates(span)
      };
    })
  };
}

function fixtureBaseBreaks(dayPlan, fixture) {
  const result = {};
  for (const employee of dayPlan.employees) {
    result[employee.id] = toMinuteBreaks(fixture.existingBreaksByEmployee?.[employee.id] ?? []);
  }
  return result;
}

async function loadFixtures() {
  const files = (await readdir(fixtureDirectory)).filter((name) => name.endsWith(".json")).sort();
  const fixtures = [];
  for (const file of files) {
    const json = JSON.parse(await readFile(path.join(fixtureDirectory, file), "utf8"));
    fixtures.push(json);
  }
  return fixtures;
}

test("フィクスチャ全件で最適化後スコアが初期解を上回らない", async () => {
  const fixtures = await loadFixtures();
  assert.ok(fixtures.length >= 5);
  for (const fixture of fixtures) {
    const dayPlan = fixtureToDayPlan(fixture);
    const targetEmployeeIds = fixture.targetEmployeeIds ?? dayPlan.employees.map((employee) => employee.id);
    const baseBreaksByEmployee = fixtureBaseBreaks(dayPlan, fixture);
    const initialBreaksByEmployee = createGreedyBreaks(dayPlan, {
      ...fixtureConfig,
      targetEmployeeIds,
      baseBreaksByEmployee
    });
    const optimized = optimizeBreaks(dayPlan, {
      ...fixtureConfig,
      targetEmployeeIds,
      initialBreaksByEmployee
    });
    assert.ok(
      optimized.score <= optimized.baselineScore,
      `${fixture.name}: ${optimized.baselineScore} -> ${optimized.score}`
    );
  }
});

test("フィクスチャ全件でハード制約検証を通過する", async () => {
  const fixtures = await loadFixtures();
  for (const fixture of fixtures) {
    const dayPlan = fixtureToDayPlan(fixture);
    const targetEmployeeIds = fixture.targetEmployeeIds ?? dayPlan.employees.map((employee) => employee.id);
    const baseBreaksByEmployee = fixtureBaseBreaks(dayPlan, fixture);
    const optimized = optimizeBreaks(dayPlan, {
      ...fixtureConfig,
      targetEmployeeIds,
      initialBreaksByEmployee: createGreedyBreaks(dayPlan, {
        ...fixtureConfig,
        targetEmployeeIds,
        baseBreaksByEmployee
      })
    });
    const hard = checkHard(dayPlan, optimized.breaksByEmployee);
    assert.equal(hard.ok, true, `${fixture.name}: ${hard.issues.join(" / ")}`);
  }
});

test("同一入力・同一シードで最適化結果が一致する", async () => {
  const fixtures = await loadFixtures();
  const fixture = fixtures[0];
  const dayPlan = fixtureToDayPlan(fixture);
  const targetEmployeeIds = fixture.targetEmployeeIds ?? dayPlan.employees.map((employee) => employee.id);
  const baseBreaksByEmployee = fixtureBaseBreaks(dayPlan, fixture);
  const initialBreaksByEmployee = createGreedyBreaks(dayPlan, {
    ...fixtureConfig,
    targetEmployeeIds,
    baseBreaksByEmployee
  });
  const first = optimizeBreaks(dayPlan, {
    ...fixtureConfig,
    targetEmployeeIds,
    initialBreaksByEmployee
  });
  const second = optimizeBreaks(dayPlan, {
    ...fixtureConfig,
    targetEmployeeIds,
    initialBreaksByEmployee
  });
  assert.equal(canonicalBreaks(first.breaksByEmployee), canonicalBreaks(second.breaksByEmployee));
});

test("ロック済み休憩は最適化で変更されない", async () => {
  const fixture = JSON.parse(await readFile(path.join(fixtureDirectory, "break-optimizer-case5.json"), "utf8"));
  const dayPlan = fixtureToDayPlan(fixture);
  const targetEmployeeIds = fixture.targetEmployeeIds ?? dayPlan.employees.map((employee) => employee.id);
  const baseBreaksByEmployee = fixtureBaseBreaks(dayPlan, fixture);
  const optimized = optimizeBreaks(dayPlan, {
    ...fixtureConfig,
    targetEmployeeIds,
    initialBreaksByEmployee: createGreedyBreaks(dayPlan, {
      ...fixtureConfig,
      targetEmployeeIds,
      baseBreaksByEmployee
    })
  });
  for (const [employeeId, breaks] of Object.entries(fixture.existingBreaksByEmployee ?? {})) {
    const lockedBreaks = breaks.filter((breakItem) => breakItem.locked === true);
    const optimizedBreaks = optimized.breaksByEmployee[employeeId] ?? [];
    for (const lockedBreak of lockedBreaks) {
      const startMinute = timeToMinutes(lockedBreak.start);
      const endMinute = timeToMinutes(lockedBreak.end);
      const matched = optimizedBreaks.some((breakItem) =>
        breakItem.startMinute === startMinute
        && breakItem.endMinute === endMinute
        && breakItem.locked === true
      );
      assert.equal(matched, true, `${employeeId}: ${lockedBreak.start}-${lockedBreak.end}`);
    }
  }
});

test("30人・1日の探索が1秒以内で完了する", () => {
  const dayPlan = {
    employees: Array.from({ length: 30 }, (_, index) => {
      const startHour = 8 + (index % 5);
      const shiftStartMinute = startHour * 60;
      const shiftEndMinute = shiftStartMinute + 9 * 60;
      return {
        id: `p${String(index + 1).padStart(2, "0")}`,
        name: `P${String(index + 1).padStart(2, "0")}`,
        order: index + 1,
        shiftStartMinute,
        shiftEndMinute,
        templates: plannedBreakTemplates(shiftEndMinute - shiftStartMinute)
      };
    })
  };
  const targetEmployeeIds = dayPlan.employees.map((employee) => employee.id);
  const initialBreaksByEmployee = createGreedyBreaks(dayPlan, {
    ...fixtureConfig,
    targetEmployeeIds
  });
  const startedAt = performance.now();
  const optimized = optimizeBreaks(dayPlan, {
    ...fixtureConfig,
    targetEmployeeIds,
    initialBreaksByEmployee
  });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(checkHard(dayPlan, optimized.breaksByEmployee).ok, true);
  assert.ok(elapsedMs < 1000, `elapsed=${elapsedMs}`);
});
