import test from "node:test";
import assert from "node:assert/strict";
import {
  activeRequirementsForWeekday,
  evaluateCoverage,
  normalizeCoverageRequirements,
  requirementAppliesToWeekday,
  requirementBounds,
  requirementIsActive
} from "../js/coverage-requirements.js";

test("必要人数を正規化して欠損値を補う", () => {
  const [requirement] = normalizeCoverageRequirements([
    { start: "09:00", end: "17:00", requiredTotal: "4", requiredByType: { fulltime: 1 } }
  ]);
  assert.equal(requirement.scope, "everyday");
  assert.equal(requirement.requiredTotal, 4);
  assert.equal(requirement.requiredByType.fulltime, 1);
  assert.equal(requirement.requiredByType.semi, 0);
  assert.equal(requirement.requiredByType.parttime, 0);
  assert.ok(typeof requirement.id === "string" && requirement.id.length > 0);
});

test("不正な時間帯や人数ゼロのバンドは非アクティブ", () => {
  assert.equal(requirementIsActive({ start: "09:00", end: "09:00", requiredTotal: 2, requiredByType: {} }), false);
  assert.equal(requirementIsActive({ start: "18:00", end: "09:00", requiredTotal: 2, requiredByType: {} }), false);
  assert.equal(requirementIsActive({ start: "09:00", end: "17:00", requiredTotal: 0, requiredByType: { fulltime: 0, semi: 0, parttime: 0 } }), false);
  assert.equal(requirementIsActive({ start: "09:00", end: "17:00", requiredTotal: 0, requiredByType: { fulltime: 1, semi: 0, parttime: 0 } }), true);
});

test("適用曜日をscopeで判定する", () => {
  assert.equal(requirementAppliesToWeekday({ scope: "weekday" }, 3), true); // 水
  assert.equal(requirementAppliesToWeekday({ scope: "weekday" }, 6), false); // 土
  assert.equal(requirementAppliesToWeekday({ scope: "weekend" }, 0), true); // 日
  assert.equal(requirementAppliesToWeekday({ scope: "weekend" }, 1), false); // 月
  assert.equal(requirementAppliesToWeekday({ scope: "everyday" }, 6), true);
});

test("曜日に合うアクティブなバンドだけを取り出す", () => {
  const requirements = [
    { start: "09:00", end: "17:00", scope: "weekday", requiredTotal: 3, requiredByType: {} },
    { start: "10:00", end: "18:00", scope: "weekend", requiredTotal: 2, requiredByType: {} }
  ];
  const weekdayList = activeRequirementsForWeekday(requirements, 2); // 火
  assert.equal(weekdayList.length, 1);
  assert.equal(weekdayList[0].scope, "weekday");

  const bounds = requirementBounds(weekdayList);
  assert.equal(bounds.start, 9 * 60);
  assert.equal(bounds.end, 17 * 60);
});

test("合計と区分別の不足を評価する", () => {
  // 09:00-10:00 の4スロット。社員2人以上・合計3人以上を要求。
  const active = activeRequirementsForWeekday(
    [{ start: "09:00", end: "10:00", requiredTotal: 3, requiredByType: { fulltime: 2 } }],
    3
  );
  const slots = [540, 555, 570, 585]; // 09:00-09:45
  const coverage = [3, 2, 3, 1];
  const coverageByType = {
    fulltime: [2, 1, 2, 0],
    semi: [0, 0, 0, 0],
    parttime: [1, 1, 1, 1]
  };
  const evaluation = evaluateCoverage({ activeRequirements: active, slots, coverage, coverageByType });

  assert.equal(evaluation.hasAnyRequirement, true);
  assert.equal(evaluation.perSlot[0].totalShort, 0);
  assert.equal(evaluation.perSlot[0].byTypeShort.fulltime, 0);
  assert.equal(evaluation.perSlot[1].byTypeShort.fulltime, 1); // 社員1人不足
  assert.equal(evaluation.perSlot[3].totalShort, 2); // 合計2人不足
  assert.equal(evaluation.perSlot[3].byTypeShort.fulltime, 2);
  assert.equal(evaluation.shortageSlotCount, 2);
  assert.equal(evaluation.messages.length, 1);
  assert.match(evaluation.messages[0], /社員2人不足/);
  assert.match(evaluation.messages[0], /合計2人不足/);
});

test("要求を満たす場合はメッセージも不足スロットも出ない", () => {
  const active = activeRequirementsForWeekday(
    [{ start: "09:00", end: "10:00", requiredTotal: 1, requiredByType: {} }],
    3
  );
  const slots = [540, 555];
  const evaluation = evaluateCoverage({
    activeRequirements: active,
    slots,
    coverage: [2, 2],
    coverageByType: { fulltime: [2, 2], semi: [0, 0], parttime: [0, 0] }
  });
  assert.equal(evaluation.shortageSlotCount, 0);
  assert.deepEqual(evaluation.messages, []);
});
