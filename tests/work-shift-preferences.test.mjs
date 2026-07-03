import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorkspace } from "../js/workspace-normalizer.js";
import {
  availableWorkShiftCodes,
  normalizeAllowedShiftCodes,
  normalizeAvoidLateEarly,
  normalizePreferredShiftCode
} from "../js/work-shift-preferences.js";

const workShifts = [
  { code: "E", isWork: true },
  { code: "M", isWork: true },
  { code: "L", isWork: true }
];

test("使用可能シフトを重複除去して正規化する", () => {
  assert.deepEqual(normalizeAllowedShiftCodes("E, M E、L"), ["E", "M", "L"]);
  assert.equal(normalizePreferredShiftCode("  M  "), "M");
  assert.equal(normalizeAvoidLateEarly(undefined), true);
  assert.equal(normalizeAvoidLateEarly("false"), false);
});

test("使用可能シフト未設定は全勤務シフトを許可する", () => {
  assert.deepEqual(availableWorkShiftCodes({ allowedShiftCodes: [] }, workShifts), ["E", "M", "L"]);
  assert.deepEqual(availableWorkShiftCodes({ allowedShiftCodes: ["M", "X"] }, workShifts), ["M"]);
});

test("既存従業員へ安全な既定値を補い、設定済み値を保持する", () => {
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
        allowedShiftCodes: ["E", "M", "E"],
        preferredShiftCode: "M",
        avoidLateEarly: false
      }
    ]
  });

  assert.deepEqual(workspace.employees[0].allowedShiftCodes, []);
  assert.equal(workspace.employees[0].preferredShiftCode, "");
  assert.equal(workspace.employees[0].avoidLateEarly, true);
  assert.deepEqual(workspace.employees[1].allowedShiftCodes, ["E", "M"]);
  assert.equal(workspace.employees[1].preferredShiftCode, "M");
  assert.equal(workspace.employees[1].avoidLateEarly, false);
});
