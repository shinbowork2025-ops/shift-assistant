import test from "node:test";
import assert from "node:assert/strict";
import {
  VALIDATION_PROFILE,
  VALIDATION_PROFILE_VERSION,
  VALIDATION_CHECKS_PERFORMED,
  VALIDATION_ITEMS_NOT_CHECKED,
  buildValidationRecord
} from "../js/validation-profile.js";

test("ツール内検証の範囲と人による確認の必要性を記録する", () => {
  const record = buildValidationRecord({
    ready: true,
    blankCount: 0,
    blockingCount: 0,
    warningCount: 1,
    infoCount: 2
  }, { checkedAt: "2026-07-18T00:00:00.000Z" });

  assert.equal(record.profile, VALIDATION_PROFILE);
  assert.equal(record.profileVersion, VALIDATION_PROFILE_VERSION);
  assert.equal(record.toolChecksPassed, true);
  assert.equal(record.checkedAt, "2026-07-18T00:00:00.000Z");
  assert.deepEqual(record.counts, { blank: 0, error: 0, warning: 1, info: 2 });
  assert.deepEqual(record.checksPerformed, [...VALIDATION_CHECKS_PERFORMED]);
  assert.deepEqual(record.notChecked, [...VALIDATION_ITEMS_NOT_CHECKED]);
  assert.deepEqual(record.humanReview, {
    requiredBeforeRegistration: true,
    approvalRecordedByTool: false
  });
});

test("未入力またはエラーが残る月の検証記録を拒否する", () => {
  assert.throws(
    () => buildValidationRecord({ ready: false, blankCount: 1, blockingCount: 0 }),
    /通過していない/
  );
  assert.throws(
    () => buildValidationRecord({ ready: true, blankCount: 0, blockingCount: 1 }),
    /通過していない/
  );
});
