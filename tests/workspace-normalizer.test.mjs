import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorkspace,
  applyWorkspaceToState,
  syncWorkspaceFromState
} from "../js/workspace-normalizer.js";

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
