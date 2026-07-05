import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { buildGreedyBreaks, optimizeBreaks } from "../js/optimizer.js";
import { checkHard } from "../js/scoring.js";
import { generateBreaksForDate } from "../js/breaks.js";
import { state } from "../js/model.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(repositoryRoot, "js", "fixtures", "break-optimizer-cases.json");

function assignmentFromShift(shift, index) {
  return {
    employee: {
      id: shift.employeeId,
      name: shift.employeeId,
      order: index + 1
    },
    shiftCode: "W",
    shiftType: {
      code: "W",
      name: "勤務",
      start: shift.start,
      end: shift.end,
      isWork: true
    }
  };
}

function breaksByEmployee(caseData) {
  return Object.fromEntries(
    caseData.shifts
      .filter((shift) => Array.isArray(shift.breaks))
      .map((shift) => [shift.employeeId, structuredClone(shift.breaks)])
  );
}

async function loadCases() {
  const text = await readFile(fixturePath, "utf8");
  return JSON.parse(text).cases;
}

test("休憩探索フィクスチャは初期解より悪化せずハード制約を満たす", async () => {
  const cases = await loadCases();
  assert.equal(cases.length >= 5, true);

  for (const caseData of cases) {
    const assignments = caseData.shifts.map(assignmentFromShift);
    const existingBreaks = breaksByEmployee(caseData);
    const initialBreaks = buildGreedyBreaks(assignments, existingBreaks, null, { seed: caseData.id });
    const optimized = optimizeBreaks({ assignments, existingBreaks, initialBreaks }, { seed: caseData.id });

    assert.equal(
      optimized.score <= optimized.initialScore,
      true,
      `${caseData.id} should not score worse than the greedy initial plan`
    );
    assert.equal(checkHard(assignments, optimized.breaks).ok, true, `${caseData.id} should pass hard checks`);
  }
});

test("同一入力と同一シードでは完全に同じ休憩案を返す", async () => {
  const caseData = (await loadCases())[2];
  const assignments = caseData.shifts.map(assignmentFromShift);
  const first = optimizeBreaks({ assignments }, { seed: "deterministic-fixture" });
  const second = optimizeBreaks({ assignments }, { seed: "deterministic-fixture" });

  assert.deepEqual(second.breaks, first.breaks);
  assert.equal(second.score, first.score);
  assert.deepEqual(second.breakdown, first.breakdown);
});

test("ロック済み休憩は変更されない", async () => {
  const caseData = (await loadCases()).find((item) => item.id === "locked-break-worker");
  const assignments = caseData.shifts.map(assignmentFromShift);
  const existingBreaks = breaksByEmployee(caseData);
  const optimized = optimizeBreaks({ assignments, existingBreaks }, { seed: "locked-fixture" });

  assert.deepEqual(optimized.breaks.e01, existingBreaks.e01);
  assert.equal(checkHard(assignments, optimized.breaks).ok, true);
});

test("30人1日分の休憩探索は1秒以内に終わる", () => {
  const shifts = Array.from({ length: 30 }, (_, index) => ({
    employeeId: `e${String(index + 1).padStart(2, "0")}`,
    start: "09:00",
    end: "18:00"
  }));
  const assignments = shifts.map(assignmentFromShift);
  const startedAt = performance.now();
  const optimized = optimizeBreaks({ assignments }, { seed: "performance-30-workers" });
  const elapsed = performance.now() - startedAt;

  assert.equal(checkHard(assignments, optimized.breaks).ok, true);
  assert.equal(elapsed < 1000, true, `elapsed=${elapsed.toFixed(1)}ms`);
});

test("既存の休憩自動配置APIから探索結果を保存できる", () => {
  state.selectedMonth = "2026-07";
  state.employees = [
    { id: "e1", name: "田中", order: 1 },
    { id: "e2", name: "佐藤", order: 2 }
  ];
  state.shiftTypes = [
    { code: "W", name: "勤務", start: "09:00", end: "18:00", isWork: true }
  ];
  state.shifts = {
    "2026-07": {
      e1: { "2026-07-02": "W" },
      e2: { "2026-07-02": "W" }
    }
  };
  state.breaks = {};

  const result = generateBreaksForDate("2026-07-02", null, {
    save: false,
    optimizerConfig: { seed: "api-integration" }
  });

  const assignments = [
    assignmentFromShift({ employeeId: "e1", start: "09:00", end: "18:00" }, 0),
    assignmentFromShift({ employeeId: "e2", start: "09:00", end: "18:00" }, 1)
  ];
  assert.equal(result.e1.length, 3);
  assert.equal(result.e2.length, 3);
  assert.deepEqual(state.breaks["2026-07-02"], result);
  assert.equal(checkHard(assignments, result).ok, true);
});
