import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { enumerateBreakPlacementCandidates } from "../../js/solver/break-placement-candidates.js";
import { placeBreaksForDay } from "../../js/solver/break-placement.js";
import { validateBreakPolicyForShift } from "../../js/solver/break-policy.js";

const constraints = {
  forbiddenStartMinutes: 60,
  forbiddenEndMinutes: 60,
  segmentWindowRadiusMinutes: 90,
  minSegmentGapMinutes: 60
};

function longShift(code = "LONG") {
  return {
    code,
    isDayOff: false,
    startMinutes: 9 * 60,
    endMinutes: 18 * 60,
    breakPolicy: {
      totalMinutes: 90,
      segments: [
        { type: "small", duration: 15, targetOffset: 120 },
        { type: "lunch", duration: 60, targetOffset: 270 },
        { type: "small", duration: 15, targetOffset: 420 }
      ]
    }
  };
}

function middleShift(code = "MIDDLE") {
  return {
    code,
    isDayOff: false,
    startMinutes: 9 * 60,
    endMinutes: 15 * 60,
    breakPolicy: {
      totalMinutes: 45,
      segments: [{ type: "lunch", duration: 45, targetOffset: 180 }]
    }
  };
}

function assignment(id, shiftType, overrides = {}) {
  return {
    employeeId: id,
    displayOrder: Number(id.replace(/\D/g, "")) || 0,
    shiftType,
    employmentType: "社員",
    department: "売場",
    qualifications: [],
    ...overrides
  };
}

function overlaps(item, startMinute, endMinute) {
  return item.startMinute < endMinute && item.endMinute > startMinute;
}

test("共通候補生成器は全セグメントの完全配置だけを決定的に列挙する", () => {
  const shift = longShift();
  const first = enumerateBreakPlacementCandidates(shift, shift.breakPolicy, [], constraints);
  const second = enumerateBreakPlacementCandidates(shift, shift.breakPolicy, [], constraints);
  assert.ok(first.length > 0);
  assert.deepEqual(first, second);
  assert.deepEqual(first[0].map((item) => item.startMinute), [660, 810, 960]);
  for (const candidate of first) {
    assert.equal(candidate.length, 3);
    assert.equal(candidate.reduce((sum, item) => sum + item.duration, 0), 90);
    assert.ok(candidate[0].startMinute >= shift.startMinutes + 60);
    assert.ok(candidate.at(-1).endMinute <= shift.endMinutes - 60);
    for (let index = 1; index < candidate.length; index += 1) {
      assert.ok(candidate[index].startMinute >= candidate[index - 1].endMinute + 60);
    }
  }
});

test("固定休憩は単一候補として維持し、矛盾する固定休憩は棄却する", () => {
  const shift = middleShift();
  const valid = [{ type: "lunch", startMinute: 12 * 60, endMinute: 12 * 60 + 45 }];
  const candidates = enumerateBreakPlacementCandidates(shift, shift.breakPolicy, valid, constraints);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0][0].startMinute, 12 * 60);

  const outside = [{ type: "lunch", startMinute: 9 * 60, endMinute: 9 * 60 + 45 }];
  assert.deepEqual(enumerateBreakPlacementCandidates(shift, shift.breakPolicy, outside, constraints), []);
});

test("休憩方針検証と候補生成器が同じ完全配置を使用する", () => {
  const shift = longShift();
  const validation = validateBreakPolicyForShift(shift, shift.breakPolicy, constraints);
  const candidates = enumerateBreakPlacementCandidates(shift, shift.breakPolicy, [], constraints);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.samplePlacement, candidates[0].map((item) => item.startMinute));
});

test("必要人数に余裕がある時間帯へ休憩を移して新しい不足を防ぐ", () => {
  const shift = middleShift();
  const result = placeBreaksForDay({
    date: "2026-07-20",
    assignments: [assignment("E1", shift), assignment("E2", shift)],
    coverageRequirements: [
      { startSlot: 48, endSlot: 52, scope: { type: "total" }, count: 2 }
    ],
    fixedBreaks: {},
    breakConstraints: constraints,
    seed: 123
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalShortagePersonSlots, 0);
  for (const breaks of Object.values(result.placements)) {
    assert.equal(breaks.some((item) => overlaps(item, 12 * 60, 13 * 60)), false);
  }
});

test("不足を回避できない場合はperson-slot不足が最小の完全配置を返す", () => {
  const shift = middleShift();
  const result = placeBreaksForDay({
    assignments: [assignment("E1", shift)],
    coverageRequirements: [
      { startSlot: 36, endSlot: 60, scope: { type: "total" }, count: 1 }
    ],
    breakConstraints: constraints
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalShortagePersonSlots, 3);
  assert.equal(result.placements.E1.length, 1);
});

test("属性別必要人数を総人数とは独立して守る", () => {
  const shift = middleShift();
  const result = placeBreaksForDay({
    assignments: [
      assignment("E1", shift, { qualifications: ["レジ"] }),
      assignment("E2", shift)
    ],
    coverageRequirements: [
      { startSlot: 48, endSlot: 52, scope: { type: "qualification", key: "レジ" }, count: 1 }
    ],
    breakConstraints: constraints
  });
  assert.equal(result.finalShortageByScope["qualification:レジ"] ?? 0, 0);
  assert.equal(result.placements.E1.some((item) => overlaps(item, 12 * 60, 13 * 60)), false);
});

test("手動固定休憩を動かさず、他従業員の休憩をずらす", () => {
  const shift = middleShift();
  const fixed = [{ type: "lunch", startMinute: 12 * 60, endMinute: 12 * 60 + 45 }];
  const result = placeBreaksForDay({
    assignments: [assignment("E1", shift), assignment("E2", shift)],
    fixedBreaks: { E2: fixed },
    breakConstraints: constraints
  });
  assert.equal(result.ok, true);
  assert.equal(result.statistics.fixedAssignmentCount, 1);
  assert.deepEqual(
    result.placements.E2.map(({ type, startMinute, endMinute }) => ({ type, startMinute, endMinute })),
    fixed
  );
  assert.equal(result.placements.E1.some((item) => overlaps(item, 12 * 60, 12 * 60 + 45)), false);
});

test("シフトと矛盾する手動固定休憩を自動解除せず配置失敗にする", () => {
  const shift = middleShift();
  const input = {
    assignments: [assignment("E1", shift)],
    fixedBreaks: {
      E1: [{ type: "lunch", startMinute: 8 * 60, endMinute: 8 * 60 + 45 }]
    },
    breakConstraints: constraints
  };
  const before = structuredClone(input);
  const result = placeBreaksForDay(input);
  assert.equal(result.ok, false);
  assert.equal(result.placements.E1.length, 0);
  assert.ok(result.unplacedSegments.every((item) => item.reason === "fixedBreakConflict"));
  assert.deepEqual(input, before);
});

test("完全配置不能を未配置のまま成功扱いしない", () => {
  const impossible = {
    code: "IMPOSSIBLE",
    isDayOff: false,
    startMinutes: 9 * 60,
    endMinutes: 12 * 60,
    breakPolicy: {
      totalMinutes: 90,
      segments: [
        { type: "lunch", duration: 45, targetOffset: 90 },
        { type: "lunch", duration: 45, targetOffset: 120 }
      ]
    }
  };
  const result = placeBreaksForDay({
    assignments: [assignment("E1", impossible)],
    breakConstraints: constraints
  });
  assert.equal(result.ok, false);
  assert.equal(result.placements.E1.length, 0);
  assert.equal(result.unplacedSegments.length, 2);
  assert.ok(result.unplacedSegments.every((item) => item.reason === "noCompletePlacement"));
});

test("同一入力とシードから同一の日別配置結果を返す", () => {
  const input = {
    assignments: Array.from({ length: 6 }, (_, index) => assignment(`E${index + 1}`, longShift())),
    coverageRequirements: [
      { startSlot: 44, endSlot: 60, scope: { type: "total" }, count: 4 }
    ],
    breakConstraints: constraints,
    seed: 987654
  };
  assert.deepEqual(placeBreaksForDay(input), placeBreaksForDay(structuredClone(input)));
});

test("15人規模の日別配置を体感遅延なく完了する", () => {
  const input = {
    assignments: Array.from({ length: 15 }, (_, index) => assignment(
      `E${index + 1}`,
      longShift(index % 2 ? "LONG-B" : "LONG-A"),
      {
        employmentType: index % 3 === 0 ? "パート" : "社員",
        department: index % 2 === 0 ? "売場" : "レジ",
        qualifications: index % 4 === 0 ? ["責任者"] : []
      }
    )),
    coverageRequirements: [
      { startSlot: 40, endSlot: 68, scope: { type: "total" }, count: 10 },
      { startSlot: 48, endSlot: 56, scope: { type: "qualification", key: "責任者" }, count: 2 },
      { startSlot: 44, endSlot: 60, scope: { type: "department", key: "レジ" }, count: 4 }
    ],
    breakConstraints: constraints,
    seed: 42
  };
  const started = performance.now();
  const result = placeBreaksForDay(input);
  const elapsed = performance.now() - started;
  assert.equal(result.ok, true);
  assert.ok(elapsed < 3_000, `15人の日別休憩配置に${elapsed.toFixed(1)}msかかりました`);
});
