import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyOverview } from "../js/daily-overview.js";

const employees = [
  { id: "e1", name: "田中", order: 1 },
  { id: "e2", name: "佐藤", order: 2 }
];
const shiftTypes = [
  { code: "early", name: "早番", start: "09:00", end: "18:00", isWork: true }
];
const shifts = {
  "2026-07": {
    e1: { "2026-07-02": "early" },
    e2: { "2026-07-02": "early" }
  }
};
const breaks = {
  "2026-07-02": {
    e1: [{ type: "lunch", label: "昼休憩", start: "12:00", end: "13:00" }],
    e2: [{ type: "lunch", label: "昼休憩", start: "13:00", end: "14:00" }]
  }
};

test("勤務・休憩セルと実配置人数を同時に構築する", () => {
  const overview = buildDailyOverview({
    dateValue: "2026-07-02",
    employees,
    shiftTypes,
    shifts,
    breaks
  });

  assert.equal(overview.range.start, 9 * 60);
  assert.equal(overview.range.end, 18 * 60);
  assert.equal(overview.rows.length, 2);

  const noonIndex = overview.slots.indexOf(12 * 60);
  const onePmIndex = overview.slots.indexOf(13 * 60);
  const twoPmIndex = overview.slots.indexOf(14 * 60);
  assert.equal(overview.rows[0].cells[noonIndex].kind, "break");
  assert.equal(overview.rows[1].cells[noonIndex].kind, "work");
  assert.equal(overview.coverage[noonIndex], 1);
  assert.equal(overview.coverage[onePmIndex], 1);
  assert.equal(overview.coverage[twoPmIndex], 2);
});

test("休憩未配置の長時間勤務を警告対象にする", () => {
  const overview = buildDailyOverview({
    dateValue: "2026-07-02",
    employees: [employees[0]],
    shiftTypes,
    shifts,
    breaks: {}
  });
  assert.equal(overview.rows[0].validation.ok, false);
  assert.equal(overview.rows[0].validation.shortage, 60);
});

test("雇用区分ごとの実配置人数を集計する", () => {
  const overview = buildDailyOverview({
    dateValue: "2026-07-02",
    employees: [
      { id: "e1", name: "田中", order: 1, employmentType: "fulltime" },
      { id: "e2", name: "佐藤", order: 2, employmentType: "parttime" },
      { id: "e3", name: "鈴木", order: 3 }
    ],
    shiftTypes,
    shifts: {
      "2026-07": {
        e1: { "2026-07-02": "early" },
        e2: { "2026-07-02": "early" },
        e3: { "2026-07-02": "early" }
      }
    },
    breaks: {
      "2026-07-02": {
        e1: [{ type: "lunch", label: "昼休憩", start: "12:00", end: "13:00" }]
      }
    }
  });

  const noonIndex = overview.slots.indexOf(12 * 60);
  const twoPmIndex = overview.slots.indexOf(14 * 60);

  // 社員は昼休憩中で0人、区分未設定はパート・アルバイト扱いになる。
  assert.equal(overview.coverageByType.fulltime[noonIndex], 0);
  assert.equal(overview.coverageByType.parttime[noonIndex], 2);
  assert.equal(overview.coverageByType.semi[noonIndex], 0);
  assert.equal(overview.coverageByType.fulltime[twoPmIndex], 1);
  assert.equal(overview.coverageByType.parttime[twoPmIndex], 2);
  assert.equal(overview.rows[0].employmentType, "fulltime");
  assert.equal(overview.rows[2].employmentType, "parttime");

  // 区分別の合計は常に全体の実配置人数と一致する。
  overview.slots.forEach((_, index) => {
    const total = overview.coverageByType.fulltime[index]
      + overview.coverageByType.semi[index]
      + overview.coverageByType.parttime[index];
    assert.equal(total, overview.coverage[index]);
  });
});
