import test from "node:test";
import assert from "node:assert/strict";
import {
  currentMonthValue,
  currentDateValue,
  isValidTime,
  timeToMinutes,
  minutesToTime,
  getDaysInMonth,
  getDayInfo,
  offsetMonthValue,
  offsetDateValue
} from "../js/date-time.js";

test("日付と月の文字列を安定して生成する", () => {
  const date = new Date(2026, 6, 2, 12, 0, 0);
  assert.equal(currentMonthValue(date), "2026-07");
  assert.equal(currentDateValue(date), "2026-07-02");
  assert.equal(offsetMonthValue("2026-01", -1), "2025-12");
  assert.equal(offsetMonthValue("2026-12", 1), "2027-01");
  assert.equal(offsetDateValue("2026-07-01", -1), "2026-06-30");
});

test("時刻の検証と分変換を行う", () => {
  assert.equal(isValidTime("09:15"), true);
  assert.equal(isValidTime("24:00"), false);
  assert.equal(timeToMinutes("09:15"), 555);
  assert.equal(minutesToTime(555), "09:15");
  assert.equal(minutesToTime(24 * 60 + 15), "00:15");
});

test("月の日数と曜日情報を返す", () => {
  assert.equal(getDaysInMonth("2024-02"), 29);
  assert.deepEqual(getDayInfo("2026-07", 2), {
    day: 2,
    weekday: 4,
    label: "木",
    dateValue: "2026-07-02"
  });
});
