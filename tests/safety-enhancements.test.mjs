import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRequestedDaysOff,
  setRequestedDayOffInData,
  removeRequestedDayOffInData
} from "../js/requested-days-off.js";
import {
  normalizeManualBreakLocks,
  setManualBreakLockInData,
  isManualBreakLockedInData
} from "../js/manual-break-locks.js";
import { evaluateCoverage, normalizeCoverageRequirements } from "../js/coverage-requirements.js";
import { parseStaffingSettingsCsv, buildStaffingSettingsCsv } from "../js/staffing-settings-csv.js";
import { roundToQuarterHour } from "../js/break-edit-ui.js";
import { evaluateSolverEmployee, evaluateSolverDay } from "../js/month-solver-score.js";

const emptyByType = { fulltime: [0], semi: [0], parttime: [0] };

test("希望休は通常ロックと別の明示データとして設定・解除できる", () => {
  const data = normalizeRequestedDaysOff({});
  assert.equal(setRequestedDayOffInData(data, "2026-07", "e1", "2026-07-10", "休"), true);
  assert.deepEqual(data["2026-07"].e1["2026-07-10"], { shiftCode: "休" });
  assert.equal(removeRequestedDayOffInData(data, "2026-07", "e1", "2026-07-10"), true);
  assert.deepEqual(data, {});
});

test("手動休憩保護は日付・従業員単位で保持する", () => {
  const data = normalizeManualBreakLocks({});
  setManualBreakLockInData(data, "2026-07-10", "e1", true);
  assert.equal(isManualBreakLockedInData(data, "2026-07-10", "e1"), true);
  setManualBreakLockInData(data, "2026-07-10", "e1", false);
  assert.equal(isManualBreakLockedInData(data, "2026-07-10", "e1"), false);
});

test("合計不足と属性不足を二重加算しない", () => {
  const activeRequirements = normalizeCoverageRequirements([{
    scope: "everyday",
    start: "09:00",
    end: "09:15",
    requiredTotal: 4,
    requiredByType: { fulltime: 1 }
  }]);
  const result = evaluateCoverage({
    activeRequirements,
    slots: [540],
    coverage: [2],
    coverageByType: emptyByType
  });
  assert.equal(result.perSlot[0].totalShort, 2);
  assert.equal(result.perSlot[0].byTypeShort.fulltime, 1);
  assert.equal(result.perSlot[0].shortagePeople, 2);
  assert.equal(result.shortagePeople, 2);
});

test("部門と資格の必要人数を評価する", () => {
  const activeRequirements = normalizeCoverageRequirements([{
    scope: "everyday",
    start: "09:00",
    end: "09:15",
    requiredDepartment: "園芸",
    requiredDepartmentCount: 2,
    requiredQualification: "農薬アドバイザー",
    requiredQualificationCount: 1
  }]);
  const result = evaluateCoverage({
    activeRequirements,
    slots: [540],
    coverage: [3],
    coverageByType: emptyByType,
    coverageByDepartment: { 園芸: [1] },
    coverageByQualification: { 農薬アドバイザー: [0] }
  });
  assert.equal(result.perSlot[0].byDepartmentShort.園芸, 1);
  assert.equal(result.perSlot[0].byQualificationShort.農薬アドバイザー, 1);
  assert.equal(result.perSlot[0].shortagePeople, 1);
});

test("配置条件CSVで資格と部門条件を往復できる", () => {
  const employees = [{ id: "e1", code: "E001", name: "田中", qualifications: [] }];
  const csv = "種別,従業員コード,氏名,保有資格,曜日,開始,終了,合計,社員,準社員,パート・アルバイト,必要部門,部門人数,必要資格,資格者人数\n"
    + "従業員資格,E001,田中,危険物取扱者;農薬アドバイザー,,,,,,,,,,,\n"
    + "必要人数,,,,平日,09:00,17:00,4,1,0,0,園芸,1,農薬アドバイザー,1";
  const parsed = parseStaffingSettingsCsv(csv, employees);
  assert.deepEqual(parsed.qualificationUpdates[0].qualifications, ["危険物取扱者", "農薬アドバイザー"]);
  assert.equal(parsed.requirements[0].requiredDepartment, "園芸");
  assert.equal(parsed.requirements[0].requiredQualificationCount, 1);
  const exported = buildStaffingSettingsCsv({
    employees: [{ ...employees[0], qualifications: parsed.qualificationUpdates[0].qualifications }],
    requirements: parsed.requirements
  });
  assert.match(exported, /農薬アドバイザー/);
  assert.match(exported, /園芸/);
});

test("15分丸めは日付をまたいで00:00へ戻らない", () => {
  assert.equal(roundToQuarterHour("23:59"), "23:45");
  assert.equal(roundToQuarterHour("10:08"), "10:15");
});

test("11時間休息は個人設定に関係なく前月境界でも判定する", () => {
  const employee = { id: "e1", name: "田中", employmentType: "fulltime", avoidLateEarly: false, fixedOvertimeMinutes: 0 };
  const shiftTypes = [
    { code: "L", name: "遅", isWork: true, start: "14:00", end: "23:00", overtimeMinutes: 0 },
    { code: "E", name: "早", isWork: true, start: "06:00", end: "15:00", overtimeMinutes: 0 },
    { code: "休", name: "休", isWork: false, start: "", end: "", overtimeMinutes: 0 }
  ];
  const assignments = { e1: Object.fromEntries(Array.from({ length: 31 }, (_, index) => [index + 1, index === 0 ? "E" : "休"])) };
  const plan = {
    monthValue: "2026-07",
    daysInMonth: 31,
    employees: [employee],
    shiftTypes,
    assignments,
    originalAssignments: structuredClone(assignments),
    allowedCodes: { e1: ["L", "E", "休"] },
    dominantCodeByEmployee: { e1: "" },
    targetDaysOffByEmployee: { e1: 30 },
    maxConsecutiveByEmployee: { e1: 6 },
    boundaryAssignments: {
      e1: {
        previousKnown: true,
        nextKnown: false,
        previousCodes: [...Array(29).fill("休"), "L"],
        nextCodes: Array(31).fill("休")
      }
    }
  };
  const metric = evaluateSolverEmployee(plan, employee);
  assert.equal(metric.shortRestCount, 1);
});

test("ソルバー日次評価に部門・資格不足を含める", () => {
  const plan = {
    monthValue: "2026-07",
    employees: [{ id: "e1", department: "園芸", qualifications: [], employmentType: "fulltime" }],
    shiftTypes: [{ code: "A", isWork: true, start: "09:00", end: "12:00" }],
    assignments: { e1: { 1: "A" } },
    coverageRequirements: [{
      scope: "everyday",
      start: "09:00",
      end: "10:00",
      requiredDepartment: "園芸",
      requiredDepartmentCount: 1,
      requiredQualification: "農薬アドバイザー",
      requiredQualificationCount: 1
    }]
  };
  const metric = evaluateSolverDay(plan, 1);
  assert.ok(metric.shortagePeople > 0);
  assert.match(metric.requirementMessages.join(" "), /農薬アドバイザー/);
});
