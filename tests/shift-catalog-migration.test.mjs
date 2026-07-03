import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHIFT_TYPES } from "../js/shift-defaults.js";
import { migrateShiftCatalog } from "../js/shift-catalog-migration.js";

const legacyTypes = [
  { code: "early", name: "早番", shortLabel: "早", start: "09:00", end: "18:00", isWork: true },
  { code: "middle", name: "中番", shortLabel: "中", start: "11:00", end: "20:00", isWork: true },
  { code: "late", name: "遅番", shortLabel: "遅", start: "12:00", end: "21:00", isWork: true },
  { code: "short", name: "短時間", shortLabel: "短", start: "09:00", end: "13:00", isWork: true },
  { code: "off", name: "公休", shortLabel: "休", start: "", end: "", isWork: false },
  { code: "7", name: "公休", shortLabel: "7", start: "", end: "", isWork: false },
  { code: "99", name: "独自勤務", shortLabel: "99", start: "10:00", end: "16:00", isWork: true }
];

test("旧デフォルトを除去し、公休を休へ統一して実デフォルトを補う", () => {
  const result = migrateShiftCatalog({
    shiftTypes: structuredClone(legacyTypes),
    shifts: {
      "2026-07": {
        e1: {
          "2026-07-01": "early",
          "2026-07-02": "off",
          "2026-07-03": "7",
          "2026-07-04": "99"
        }
      }
    },
    breaks: {
      "2026-07-01": { e1: [{ start: "12:00", end: "13:00" }] },
      "2026-07-02": { e1: [{ start: "12:00", end: "13:00" }] }
    },
    shiftLocks: {
      "2026-07": {
        e1: {
          "2026-07-01": true,
          "2026-07-02": true
        }
      }
    },
    employees: [{
      id: "e1",
      name: "田中",
      allowedShiftCodes: ["early", "99"],
      preferredShiftCode: "late"
    }],
    defaultShiftTypes: DEFAULT_SHIFT_TYPES
  });

  const codes = result.shiftTypes.map((shiftType) => shiftType.code);
  assert.equal(result.migrated, true);
  assert.equal(result.removedAssignments, 1);
  assert.equal(result.convertedPublicHolidays, 2);
  assert.equal(codes.includes("early"), false);
  assert.equal(codes.includes("middle"), false);
  assert.equal(codes.includes("late"), false);
  assert.equal(codes.includes("short"), false);
  assert.equal(codes.includes("off"), false);
  assert.equal(codes.includes("7"), false);
  assert.equal(codes.includes("01"), true);
  assert.equal(codes.includes("32"), true);
  assert.equal(codes.includes("休"), true);
  assert.equal(codes.includes("99"), true);

  assert.deepEqual(result.shifts, {
    "2026-07": {
      e1: {
        "2026-07-02": "休",
        "2026-07-03": "休",
        "2026-07-04": "99"
      }
    }
  });
  assert.equal(result.breaks["2026-07-01"], undefined);
  assert.ok(result.breaks["2026-07-02"]);
  assert.equal(result.shiftLocks["2026-07"].e1["2026-07-01"], undefined);
  assert.equal(result.shiftLocks["2026-07"].e1["2026-07-02"], true);
  assert.deepEqual(result.employees[0].allowedShiftCodes, ["99"]);
  assert.equal(result.employees[0].preferredShiftCode, "");
});

test("勤務コード7を公休と誤認しない", () => {
  const result = migrateShiftCatalog({
    shiftTypes: [{ code: "7", name: "勤務7", shortLabel: "7", start: "09:00", end: "18:00", isWork: true }],
    shifts: { "2026-07": { e1: { "2026-07-01": "7" } } },
    breaks: {},
    shiftLocks: {},
    employees: [],
    defaultShiftTypes: DEFAULT_SHIFT_TYPES
  });

  assert.equal(result.migrated, false);
  assert.equal(result.shiftTypes[0].code, "7");
  assert.equal(result.shifts["2026-07"].e1["2026-07-01"], "7");
});
