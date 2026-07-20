import test from "node:test";
import assert from "node:assert/strict";
import {
  archivedCandidates,
  considerCandidate,
  createCandidateArchives
} from "../js/month-solver-archive.js";
import { finalizeMonthSolverCandidates } from "../js/month-solver-finalize.js";
import { createSolverBreakChanges } from "../js/month-solver-worker-protocol.js";

function objective(scalar, overrides = {}) {
  return {
    scalar,
    vector: [0, 0, 0, 0, 0, 0],
    statutoryViolationCount: 0,
    statutoryViolationAmount: 0,
    internalViolationCount: 0,
    internalViolationAmount: 0,
    overtime: 0,
    fairness: 0,
    preference: 0,
    shortagePeople: 0,
    ...overrides
  };
}

function archivePlan() {
  return {
    monthValue: "2026-07",
    daysInMonth: 1,
    employees: [{ id: "e1" }],
    selectedEmployeeIds: ["e1"],
    assignments: { e1: { 1: "A" } },
    originalAssignments: { e1: { 1: "A" } }
  };
}

function rerankPlan() {
  return {
    monthValue: "2026-07",
    daysInMonth: 1,
    employees: [
      { id: "e1", name: "A", order: 1, employmentType: "fulltime" },
      { id: "e2", name: "B", order: 2, employmentType: "fulltime" }
    ],
    shiftTypes: [
      { code: "E", name: "通常", start: "09:00", end: "17:00", isWork: true, overtimeMinutes: 0 },
      { code: "S", name: "短時間", start: "11:00", end: "15:00", isWork: true, overtimeMinutes: 0 }
    ],
    coverageRequirements: [{
      scope: "everyday",
      start: "11:15",
      end: "15:00",
      requiredTotal: 2,
      requiredByType: {}
    }],
    selectedEmployeeIds: ["e1", "e2"],
    selectedShiftCodes: ["E", "S"],
    assignments: { e1: { 1: "E" }, e2: { 1: "E" } },
    originalAssignments: { e1: { 1: "E" }, e2: { 1: "E" } },
    breaks: {},
    manualBreakLocks: {}
  };
}

test("適合案と要修正案を分離し、重複を除いて各上位5件だけ保持する", () => {
  const plan = archivePlan();
  const archives = createCandidateArchives();
  for (let index = 7; index >= 1; index -= 1) {
    considerCandidate(archives, {
      plan,
      changes: [{ employeeId: "e1", day: 1, after: `C${index}` }],
      objective: objective(index)
    });
  }
  considerCandidate(archives, {
    plan,
    changes: [{ employeeId: "e1", day: 1, after: "C1" }],
    objective: objective(1)
  });
  considerCandidate(archives, {
    plan,
    changes: [{ employeeId: "e1", day: 1, after: "R" }],
    objective: objective(0, { internalViolationCount: 1, internalViolationAmount: 1 })
  });

  assert.deepEqual(archives.feasible.map((item) => item.objective.scalar), [1, 2, 3, 4, 5]);
  assert.equal(archives.repairable.length, 1);
  assert.equal(archives.duplicates, 1);
  assert.equal(archivedCandidates(archives).length, 6);
});

test("見込みスコア1位ではなく、休憩実配置後の不足が少ない候補を最終選択する", () => {
  const plan = rerankPlan();
  const archives = createCandidateArchives();
  considerCandidate(archives, { plan, objective: objective(10) });
  considerCandidate(archives, {
    plan,
    changes: [{ employeeId: "e2", day: 1, after: "S" }],
    objective: objective(20)
  });

  const finalized = finalizeMonthSolverCandidates(archives, { masterSeed: 7 });
  assert.equal(finalized.finalized.length, 2);
  const estimatedFirst = finalized.finalized.find((item) => item.objective.scalar === 10);
  const estimatedSecond = finalized.finalized.find((item) => item.objective.scalar === 20);
  assert.equal(estimatedFirst.finalShortagePersonSlots, 6);
  assert.equal(estimatedSecond.finalShortagePersonSlots, 3);
  assert.equal(finalized.best.objective.scalar, 20);
  assert.equal(finalized.best.plan.assignments.e2[1], "S");
  assert.equal(finalized.best.placementOk, true);
});

test("休憩差分を日付・従業員単位でbefore/after付き生成する", () => {
  const before = {
    "2026-07-01": {
      e1: [{ type: "lunch", start: "12:00", end: "12:45" }]
    }
  };
  const after = {
    "2026-07-01": {
      e1: [{ type: "lunch", start: "13:00", end: "13:45" }],
      e2: [{ type: "small", start: "14:00", end: "14:15" }]
    }
  };
  assert.deepEqual(createSolverBreakChanges(before, after), [
    {
      date: "2026-07-01",
      employeeId: "e1",
      before: before["2026-07-01"].e1,
      after: after["2026-07-01"].e1
    },
    {
      date: "2026-07-01",
      employeeId: "e2",
      before: [],
      after: after["2026-07-01"].e2
    }
  ]);
  assert.deepEqual(
    createSolverBreakChanges(before, before, ["2026-07-01:e1"]),
    [{
      date: "2026-07-01",
      employeeId: "e1",
      before: before["2026-07-01"].e1,
      after: before["2026-07-01"].e1
    }]
  );
});

test("手動固定休憩と候補シフトが矛盾する案をinvalidとして最終候補から除外する", () => {
  const plan = rerankPlan();
  plan.breaks = {
    "2026-07-01": {
      e1: [{ type: "lunch", start: "08:00", end: "08:45" }]
    }
  };
  plan.manualBreakLocks = { "2026-07-01": { e1: true } };
  const archives = createCandidateArchives();
  considerCandidate(archives, { plan, objective: objective(1) });
  const finalized = finalizeMonthSolverCandidates(archives);
  assert.equal(finalized.best, null);
  assert.equal(finalized.finalized[0].classification, "invalid");
  assert.equal(finalized.finalized[0].unplacedSegments[0].reason, "fixedBreakConflict");

  const dayOffPlan = rerankPlan();
  dayOffPlan.shiftTypes.push({ code: "OFF", name: "休", start: "", end: "", isWork: false });
  dayOffPlan.assignments.e1[1] = "OFF";
  dayOffPlan.breaks = {
    "2026-07-01": {
      e1: [{ type: "lunch", start: "12:00", end: "12:45" }]
    }
  };
  dayOffPlan.manualBreakLocks = { "2026-07-01": { e1: true } };
  const dayOffArchives = createCandidateArchives();
  considerCandidate(dayOffArchives, { plan: dayOffPlan, objective: objective(1) });
  const dayOffFinalized = finalizeMonthSolverCandidates(dayOffArchives);
  assert.equal(dayOffFinalized.best, null);
  assert.equal(dayOffFinalized.finalized[0].unplacedSegments[0].reason, "fixedBreakConflict");
});
