import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EMPLOYMENT_TYPE,
  EMPLOYMENT_TYPES,
  employmentTypeLabel,
  matchEmploymentType,
  normalizeEmploymentType
} from "../js/employment-types.js";

test("表記ゆれを含む雇用区分の文字列を判定する", () => {
  assert.equal(matchEmploymentType("社員"), "fulltime");
  assert.equal(matchEmploymentType("正社員"), "fulltime");
  assert.equal(matchEmploymentType("準社員"), "semi");
  assert.equal(matchEmploymentType("パート"), "parttime");
  assert.equal(matchEmploymentType("アルバイト"), "parttime");
  assert.equal(matchEmploymentType("パート・アルバイト"), "parttime");
  assert.equal(matchEmploymentType("fulltime"), "fulltime");
  assert.equal(matchEmploymentType("派遣"), null);
  assert.equal(matchEmploymentType(""), null);
  assert.equal(matchEmploymentType(undefined), null);
});

test("不明な値は既定の区分へ正規化する", () => {
  assert.equal(normalizeEmploymentType("社員"), "fulltime");
  assert.equal(normalizeEmploymentType("unknown"), DEFAULT_EMPLOYMENT_TYPE);
  assert.equal(normalizeEmploymentType(null), DEFAULT_EMPLOYMENT_TYPE);
});

test("ラベルは全区分に定義されている", () => {
  for (const type of EMPLOYMENT_TYPES) {
    assert.ok(employmentTypeLabel(type.code).length > 0);
  }
  assert.equal(employmentTypeLabel("nonsense"), employmentTypeLabel(DEFAULT_EMPLOYMENT_TYPE));
});
