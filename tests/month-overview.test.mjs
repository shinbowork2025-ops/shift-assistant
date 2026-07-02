import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthOverview } from "../js/month-overview.js";

const employees = [
  { id: "e1", name: "田中", fixedOvertimeMinutes: 120 },
  { id: "e2", name: "佐藤", fixedOvertimeMinutes: 0 }
];
const shiftTypes = [
  { code: "early", name: "早番", start: "09:00", end: "18:00", isWork: true, overtimeMinutes: 60 },
  { code: "off", name: "公休", start: "", end: "", isWork: false, paidMinutes: 0, overtimeMinutes: 0 }
];
const shifts = {
  "2026-07": {
    e1: { "2026-07-01": "early", "2026-07-02": "off" },
    e2: { "2026-07-01": "early", "2026-07-02": "early" }
  }
};

test("月間の従業員集計と日別集計を1回の走査で構築する", () => {
  const overview = buildMonthOverview({ monthValue: "2026-07", employees, shiftTypes, shifts });
  assert.equal(overview.days.length, 31);
  assert.equal(overview.employeeRows.length, 2);

  const tanaka = overview.employeeRows[0];
  assert.equal(tanaka.cells[0].code, "early");
  assert.equal(tanaka.cells[1].code, "off");
  assert.equal(tanaka.summary.workDays, 1);
  assert.equal(tanaka.summary.paidMinutes, 450);
  assert.equal(tanaka.summary.overtimeMinutes, 60);
  assert.equal(tanaka.summary.overtimeRemainingMinutes, 60);

  assert.equal(overview.daySummaries[0].workers, 2);
  assert.equal(overview.daySummaries[0].paidMinutes, 900);
  assert.equal(overview.daySummaries[0].overtimeMinutes, 120);
  assert.equal(overview.daySummaries[1].workers, 1);
});

test("未入力日は空コードとして扱う", () => {
  const overview = buildMonthOverview({ monthValue: "2026-07", employees, shiftTypes, shifts: {} });
  assert.equal(overview.employeeRows[0].cells[0].code, "");
  assert.equal(overview.employeeRows[0].summary.workDays, 0);
  assert.equal(overview.daySummaries[0].workers, 0);
});
