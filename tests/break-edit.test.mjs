import test from "node:test";
import assert from "node:assert/strict";
import { state, setEmployeeBreaksForDate } from "../js/model.js";

// scheduleSave()を呼ぶとIndexedDBアクセスの非同期タイマーが走るため、
// すべての呼び出しで{ save: false }を指定してモデルの純粋な状態更新だけを検証する。

test("1人分の休憩配列だけを差し替え、他の従業員の配列は維持する", () => {
  const dateValue = "2026-07-02";
  state.breaks[dateValue] = {
    e1: [{ type: "lunch", label: "昼休憩", start: "12:00", end: "12:45" }],
    e2: [{ type: "small", label: "小休憩", start: "15:00", end: "15:15" }]
  };

  setEmployeeBreaksForDate(dateValue, "e1", [
    { type: "lunch", label: "昼休憩", start: "12:30", end: "13:15" }
  ], { save: false });

  assert.deepEqual(state.breaks[dateValue].e1, [
    { type: "lunch", label: "昼休憩", start: "12:30", end: "13:15" }
  ]);
  assert.deepEqual(state.breaks[dateValue].e2, [
    { type: "small", label: "小休憩", start: "15:00", end: "15:15" }
  ]);

  delete state.breaks[dateValue];
});

test("空配列を渡すとその従業員のキーだけ削除する", () => {
  const dateValue = "2026-07-03";
  state.breaks[dateValue] = {
    e1: [{ type: "lunch", label: "昼休憩", start: "12:00", end: "12:45" }],
    e2: [{ type: "small", label: "小休憩", start: "15:00", end: "15:15" }]
  };

  setEmployeeBreaksForDate(dateValue, "e1", [], { save: false });

  assert.equal(Object.hasOwn(state.breaks[dateValue], "e1"), false);
  assert.deepEqual(state.breaks[dateValue].e2, [
    { type: "small", label: "小休憩", start: "15:00", end: "15:15" }
  ]);

  delete state.breaks[dateValue];
});

test("最後の従業員の休憩を空にすると、その日付のキー自体を削除する", () => {
  const dateValue = "2026-07-04";
  state.breaks[dateValue] = {
    e1: [{ type: "lunch", label: "昼休憩", start: "12:00", end: "12:45" }]
  };

  setEmployeeBreaksForDate(dateValue, "e1", [], { save: false });

  assert.equal(Object.hasOwn(state.breaks, dateValue), false);
});

test("新しい日付・従業員へ休憩を新規追加できる", () => {
  const dateValue = "2026-07-05";
  assert.equal(Object.hasOwn(state.breaks, dateValue), false);

  setEmployeeBreaksForDate(dateValue, "e9", [
    { type: "small", label: "小休憩", start: "10:00", end: "10:15" }
  ], { save: false });

  assert.deepEqual(state.breaks[dateValue].e9, [
    { type: "small", label: "小休憩", start: "10:00", end: "10:15" }
  ]);

  delete state.breaks[dateValue];
});
