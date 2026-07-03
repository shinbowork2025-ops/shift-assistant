import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEmployees,
  normalizeWorkspace,
  applyWorkspaceToState,
  syncWorkspaceFromState
} from "../js/workspace-normalizer.js";
import {
  isShiftLockedInData,
  setShiftLockInData,
  clearMonthShiftLocks,
  removeEmployeeShiftLocks
} from "../js/shift-locks.js";

test("印刷ビューを含むワークスペース状態を維持する", () => {
  const workspace = normalizeWorkspace({
    id: "w1",
    name: "園芸",
    selectedMonth: "2026-07",
    selectedDate: "2026-07-02",
    currentView: "print",
    employees: [],
    shiftTypes: [],
    shifts: {},
    breaks: {}
  });
  assert.equal(workspace.currentView, "print");
  assert.deepEqual(workspace.shiftLocks, {});
});

test("ワークスペース読込時は編集状態を独立コピーする", () => {
  const workspace = normalizeWorkspace({
    id: "w1",
    name: "園芸",
    selectedMonth: "2026-07",
    selectedDate: "2026-07-02",
    employees: [{ id: "e1", name: "田中" }],
    shiftTypes: [],
    shifts: {},
    breaks: {},
    shiftLocks: {
      "2026-07": { e1: { "2026-07-02": true } }
    }
  });
  const targetState = {};
  applyWorkspaceToState(targetState, workspace);
  targetState.employees[0].name = "佐藤";
  targetState.shiftLocks["2026-07"].e1["2026-07-02"] = false;
  assert.equal(workspace.employees[0].name, "田中");
  assert.equal(workspace.shiftLocks["2026-07"].e1["2026-07-02"], true);
});

test("保存前同期は大きなデータを再複製せず参照を共有する", () => {
  const workspace = normalizeWorkspace({
    id: "w1",
    name: "園芸",
    selectedMonth: "2026-07",
    selectedDate: "2026-07-02",
    employees: [],
    shiftTypes: [],
    shifts: {},
    breaks: {}
  });
  const state = {
    selectedMonth: "2026-08",
    selectedDate: "2026-08-03",
    currentView: "month",
    employees: [{ id: "e1", name: "田中" }],
    shiftTypes: [],
    shifts: { "2026-08": {} },
    breaks: {},
    shiftLocks: {
      "2026-08": { e1: { "2026-08-03": true } }
    },
    updatedAt: "2026-07-02T00:00:00.000Z"
  };
  syncWorkspaceFromState(workspace, state);
  assert.equal(workspace.employees, state.employees);
  assert.equal(workspace.shifts, state.shifts);
  assert.equal(workspace.shiftLocks, state.shiftLocks);
  assert.equal(workspace.selectedMonth, "2026-08");
});

test("不正なロック値と対象月外の日付を正規化で除外する", () => {
  const workspace = normalizeWorkspace({
    id: "w1",
    name: "園芸",
    selectedMonth: "2026-07",
    selectedDate: "2026-07-02",
    employees: [],
    shiftTypes: [],
    shifts: {},
    breaks: {},
    shiftLocks: {
      "2026-07": {
        e1: {
          "2026-07-01": true,
          "2026-07-02": false,
          "2026-08-01": true
        }
      }
    }
  });
  assert.deepEqual(workspace.shiftLocks, {
    "2026-07": { e1: { "2026-07-01": true } }
  });
});

test("ロックデータをセル・従業員・月単位で整理する", () => {
  const locks = {};
  setShiftLockInData(locks, "2026-07", "e1", "2026-07-01", true);
  setShiftLockInData(locks, "2026-07", "e1", "2026-07-02", true);
  setShiftLockInData(locks, "2026-07", "e2", "2026-07-03", true);
  setShiftLockInData(locks, "2026-08", "e1", "2026-08-01", true);
  assert.equal(isShiftLockedInData(locks, "2026-07", "e1", "2026-07-01"), true);

  setShiftLockInData(locks, "2026-07", "e1", "2026-07-01", false);
  assert.equal(isShiftLockedInData(locks, "2026-07", "e1", "2026-07-01"), false);
  assert.equal(removeEmployeeShiftLocks(locks, "e1"), 2);
  assert.deepEqual(locks, { "2026-07": { e2: { "2026-07-03": true } } });
  assert.equal(clearMonthShiftLocks(locks, "2026-07"), 1);
  assert.deepEqual(locks, {});
});

test("既存従業員は手動扱い、新設定は正規化して保持する", () => {
  const workspace = normalizeWorkspace({
    id: "w1",
    name: "園芸",
    selectedMonth: "2026-07",
    selectedDate: "2026-07-01",
    shiftTypes: [],
    shifts: {},
    breaks: {},
    employees: [
      { id: "e1", name: "旧データ" },
      {
        id: "e2",
        name: "設定済み",
        restPatternId: "3on1off",
        restPatternOffset: 2,
        targetDaysOff: 9,
        fixedDaysOff: [1, 4, 4, 9]
      }
    ]
  });
  assert.equal(workspace.employees[0].restPatternId, "none");
  assert.equal(workspace.employees[0].restPatternOffset, -1);
  assert.equal(workspace.employees[0].targetDaysOff, 0);
  assert.deepEqual(workspace.employees[0].fixedDaysOff, []);
  assert.equal(workspace.employees[1].restPatternId, "3on1off");
  assert.equal(workspace.employees[1].restPatternOffset, 2);
  assert.equal(workspace.employees[1].targetDaysOff, 9);
  assert.deepEqual(workspace.employees[1].fixedDaysOff, [1, 4]);
});

test("従業員の雇用区分を正規化して保持する", () => {
  const employees = normalizeEmployees([
    { id: "e1", name: "田中", order: 1, employmentType: "fulltime" },
    { id: "e2", name: "佐藤", order: 2, employmentType: "準社員" },
    { id: "e3", name: "鈴木", order: 3 }
  ]);

  assert.equal(employees[0].employmentType, "fulltime");
  assert.equal(employees[1].employmentType, "semi");
  // 区分未設定の既存データはパート・アルバイト扱いで読み込む。
  assert.equal(employees[2].employmentType, "parttime");
});
