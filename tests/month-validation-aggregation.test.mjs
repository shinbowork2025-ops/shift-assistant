import test from "node:test";
import assert from "node:assert/strict";
import {
  groupMonthValidationIssues,
  validateMonthReadiness
} from "../js/month-validation.js";

test("同じカテゴリ・従業員・日付の問題を1項目へ集約する", () => {
  const grouped = groupMonthValidationIssues([
    { severity: "error", category: "coverage", day: 3, message: "3日 9:00に1人不足" },
    { severity: "error", category: "coverage", day: 3, message: "3日 9:15に1人不足" },
    { severity: "error", category: "coverage", day: 4, message: "4日 9:00に1人不足" },
    { severity: "warning", category: "break-lock", employeeId: "e1", employeeName: "田中", day: 3, message: "田中さんの3日に休憩保護だけがあります" }
  ]);

  assert.equal(grouped.length, 3);
  const coverageDay3 = grouped.find((item) => item.category === "coverage" && item.day === 3);
  assert.equal(coverageDay3.groupedCount, 2);
  assert.equal(coverageDay3.detailMessages.length, 2);
  assert.match(coverageDay3.message, /3日・必要人数：2件/);
});

test("空欄はエラー件数から除外し、未入力セル数として返す", () => {
  const result = validateMonthReadiness({
    monthValue: "2026-07",
    employees: [{ id: "e1", name: "田中", fixedOvertimeMinutes: 0, restPatternId: "" }],
    shiftTypes: [
      { code: "E", name: "早番", start: "09:00", end: "18:00", isWork: true, overtimeMinutes: 0 },
      { code: "休", name: "公休", start: "", end: "", isWork: false, overtimeMinutes: 0 }
    ],
    shifts: {},
    breaks: {},
    shiftLocks: {},
    requestedDaysOff: {},
    manualBreakLocks: {},
    coverageRequirements: []
  });

  assert.equal(result.blankCount, 31);
  assert.equal(result.blankByEmployee[0].count, 31);
  assert.equal(result.blockingCount, 0);
  assert.equal(result.ready, false, "未入力が残る月を転記準備OKにしてはいけません");
  assert.equal(result.issues.some((item) => item.category === "blank"), false);
});
