import { readFileSync } from "node:fs";

const FIXTURE_ROOT = new URL("./fixtures/", import.meta.url);

function readFixture(name) {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_ROOT), "utf8"));
}

export function loadBoard(name) {
  const fixture = readFixture(name);
  const base = fixture.base ? loadBoard(fixture.base) : structuredClone(fixture);
  const employeeIndexes = new Map(base.employeeOrder.map((employeeId, index) => [employeeId, index]));
  for (const change of fixture.assignmentChanges ?? []) {
    base.assignments[employeeIndexes.get(change.employeeId)][change.day] = change.shiftCode;
  }
  for (const change of fixture.requirementChanges ?? []) {
    Object.assign(base.requirements[change.index], change);
    delete base.requirements[change.index].index;
  }
  Object.assign(base.settings, fixture.settingChanges ?? {});
  return base;
}

export function boardToEvaluationInput(board, baselineBoard = board) {
  const plan = {
    periodStart: board.periodStart,
    dayCount: board.assignments[0].length,
    employeeOrder: [...board.employeeOrder],
    assignments: structuredClone(board.assignments),
    lockedCells: new Set()
  };
  const baselinePlan = {
    periodStart: baselineBoard.periodStart,
    dayCount: baselineBoard.assignments[0].length,
    employeeOrder: [...baselineBoard.employeeOrder],
    assignments: structuredClone(baselineBoard.assignments),
    lockedCells: new Set()
  };
  return {
    plan,
    context: {
      shiftTypes: new Map(board.shiftTypes.map((shiftType) => [shiftType.code, structuredClone(shiftType)])),
      employees: new Map(board.employees.map((employee) => [employee.id, structuredClone(employee)])),
      settings: structuredClone(board.settings),
      requirements: structuredClone(board.requirements),
      preferences: structuredClone(board.preferences),
      baselinePlan
    }
  };
}
