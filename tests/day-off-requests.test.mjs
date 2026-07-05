import test from "node:test";
import assert from "node:assert/strict";
import {
  clearMonthDayOffRequests,
  isDayOffRequestedInData,
  normalizeDayOffRequests,
  removeEmployeeDayOffRequests,
  requestedDaysForEmployee,
  setDayOffRequestInData
} from "../js/day-off-requests.js";
import { normalizeWorkspace } from "../js/workspace-normalizer.js";

test("希望休を月・従業員・日付単位で正規化する", () => {
  const normalized = normalizeDayOffRequests({
    "2026-07": {
      e1: {
        "2026-07-01": true,
        "2026-07-02": false,
        "2026-08-01": true,
        "2026-07-32": true
      }
    },
    invalid: { e1: { "2026-07-01": true } }
  });
  assert.deepEqual(normalized, { "2026-07": { e1: { "2026-07-01": true } } });
});

test("希望休の追加・削除・月削除・従業員削除", () => {
  const data = {};
  setDayOffRequestInData(data, "2026-07", "e1", "2026-07-01", true);
  setDayOffRequestInData(data, "2026-07", "e1", "2026-07-02", true);
  setDayOffRequestInData(data, "2026-08", "e1", "2026-08-01", true);
  setDayOffRequestInData(data, "2026-07", "e2", "2026-07-03", true);
  assert.equal(isDayOffRequestedInData(data, "2026-07", "e1", "2026-07-01"), true);
  assert.deepEqual(requestedDaysForEmployee(data, "2026-07", "e1"), ["2026-07-01", "2026-07-02"]);

  setDayOffRequestInData(data, "2026-07", "e1", "2026-07-01", false);
  assert.equal(removeEmployeeDayOffRequests(data, "e1"), 2);
  assert.deepEqual(data, { "2026-07": { e2: { "2026-07-03": true } } });
  assert.equal(clearMonthDayOffRequests(data, "2026-07"), 1);
  assert.deepEqual(data, {});
});

test("ワークスペースの読込に希望休を保持する", () => {
  const workspace = normalizeWorkspace({
    id: "w1",
    name: "月間案",
    selectedMonth: "2026-07",
    selectedDate: "2026-07-01",
    employees: [{ id: "e1", name: "田中" }],
    shiftTypes: [],
    shifts: {},
    breaks: {},
    shiftLocks: {},
    dayOffRequests: { "2026-07": { e1: { "2026-07-15": true } } }
  });
  assert.deepEqual(workspace.dayOffRequests, { "2026-07": { e1: { "2026-07-15": true } } });
});
