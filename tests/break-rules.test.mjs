import test from "node:test";
import assert from "node:assert/strict";
import {
  plannedBreakMinutes,
  requiredBreakMinutes,
  validateBreakTotals,
  validateBreaks
} from "../js/break-rules.js";

const boundaryCases = [
  { label: "4:00", span: 240, planned: 0 },
  { label: "4:01", span: 241, planned: 15 },
  { label: "5:00", span: 300, planned: 15 },
  { label: "5:01", span: 301, planned: 45 },
  { label: "6:00", span: 360, planned: 45 },
  { label: "6:01", span: 361, planned: 45 },
  { label: "6:45", span: 405, planned: 45 },
  { label: "7:00", span: 420, planned: 45 },
  { label: "8:00", span: 480, planned: 45 },
  { label: "8:45", span: 525, planned: 45 },
  { label: "8:46", span: 526, planned: 60 },
  { label: "9:00", span: 540, planned: 90 },
  { label: "12:00", span: 720, planned: 90 }
];

test("休憩計画の境界ケースが法定基準と整合する", () => {
  for (const testCase of boundaryCases) {
    const actual = plannedBreakMinutes(testCase.span);
    const validation = validateBreakTotals(testCase.span, actual);
    assert.equal(actual, testCase.planned, `${testCase.label}の自動休憩`);
    assert.equal(validation.ok, true, `${testCase.label}の法定判定`);
    assert.ok(actual >= requiredBreakMinutes(validation.work), `${testCase.label}の必要休憩`);
  }
});

test("実働6時間超8時間以下には45分を要求する", () => {
  assert.equal(requiredBreakMinutes(360), 0);
  assert.equal(requiredBreakMinutes(361), 45);
  assert.equal(requiredBreakMinutes(480), 45);
});

test("実働8時間超には60分を要求する", () => {
  assert.equal(requiredBreakMinutes(481), 60);
});

test("7時間拘束に15分だけでは不足を検出する", () => {
  const result = validateBreaks(
    { isWork: true, start: "09:00", end: "16:00" },
    [{ type: "small", start: "11:00", end: "11:15" }]
  );
  assert.equal(result.ok, false);
  assert.equal(result.required, 45);
  assert.equal(result.actual, 15);
  assert.equal(result.shortage, 30);
});

test("7時間拘束に45分を途中配置すると適合する", () => {
  const result = validateBreaks(
    { isWork: true, start: "09:00", end: "16:00" },
    [{ type: "lunch", start: "12:00", end: "12:45" }]
  );
  assert.equal(result.ok, true);
  assert.equal(result.work, 375);
  assert.equal(result.required, 45);
  assert.equal(result.actual, 45);
});

test("9時間拘束の店舗ルール90分休憩は適合する", () => {
  const result = validateBreaks(
    { isWork: true, start: "09:00", end: "18:00" },
    [
      { type: "small", start: "11:00", end: "11:15" },
      { type: "lunch", start: "13:00", end: "14:00" },
      { type: "small", start: "16:15", end: "16:30" }
    ]
  );
  assert.equal(result.ok, true);
  assert.equal(result.work, 450);
  assert.equal(result.actual, 90);
});

test("始業直後・終業直前の休憩を不正として検出する", () => {
  const result = validateBreaks(
    { isWork: true, start: "09:00", end: "16:00" },
    [{ type: "lunch", start: "09:00", end: "09:45" }]
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("途中")));
});

test("勤務時間の外側だけにある休憩を休憩合計へ含めない", () => {
  const result = validateBreaks(
    { isWork: true, start: "09:00", end: "18:00" },
    [{ type: "small", start: "08:00", end: "08:30" }]
  );
  assert.equal(result.ok, false);
  assert.equal(result.actual, 0);
  assert.equal(result.work, 540);
  assert.equal(result.required, 60);
  assert.equal(result.shortage, 60);
  assert.ok(result.issues.some((issue) => issue.includes("途中")));
});
