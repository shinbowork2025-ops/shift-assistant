import test from "node:test";
import assert from "node:assert/strict";
import {
  activeRequirementsForWeekday,
  evaluateCoverage
} from "../js/coverage-requirements.js";

const EMPTY_BY_TYPE = {
  fulltime: [0, 0],
  semi: [0, 0],
  parttime: [0, 0]
};

test("15分境界内だけの要件も重なるスロットで不足評価する", () => {
  const active = activeRequirementsForWeekday(
    [{ start: "09:01", end: "09:14", requiredTotal: 1, requiredByType: {} }],
    3
  );
  const evaluation = evaluateCoverage({
    activeRequirements: active,
    slots: [540, 555],
    coverage: [0, 0],
    coverageByType: EMPTY_BY_TYPE
  });

  assert.equal(evaluation.perSlot[0].hasRequirement, true);
  assert.equal(evaluation.perSlot[0].totalShort, 1);
  assert.equal(evaluation.perSlot[1].hasRequirement, false);
  assert.equal(evaluation.shortageSlotCount, 1);
  assert.equal(evaluation.bandReports[0].ok, false);
  assert.match(evaluation.messages[0], /09:01〜09:14：合計1人不足/);
});

test("要件の終了時刻と同じ位置から始まるスロットは対象外", () => {
  const active = activeRequirementsForWeekday(
    [{ start: "09:01", end: "09:15", requiredTotal: 1, requiredByType: {} }],
    3
  );
  const evaluation = evaluateCoverage({
    activeRequirements: active,
    slots: [540, 555],
    coverage: [0, 0],
    coverageByType: EMPTY_BY_TYPE
  });

  assert.equal(evaluation.perSlot[0].hasRequirement, true);
  assert.equal(evaluation.perSlot[1].hasRequirement, false);
  assert.equal(evaluation.shortageSlotCount, 1);
});
