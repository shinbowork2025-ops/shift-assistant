import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryStack } from "../js/history-stack.js";

function entry(label, beforeValue, afterValue) {
  return {
    label,
    before: { value: beforeValue },
    after: { value: afterValue }
  };
}

test("記録した操作を元に戻してやり直せる", () => {
  const stack = createHistoryStack(5);
  stack.record(entry("シフト変更", "早", "遅"));

  assert.equal(stack.status().canUndo, true);
  assert.equal(stack.status().undoLabel, "シフト変更");

  const undone = stack.undo();
  assert.deepEqual(undone.before, { value: "早" });
  assert.equal(stack.status().canUndo, false);
  assert.equal(stack.status().canRedo, true);

  const redone = stack.redo();
  assert.deepEqual(redone.after, { value: "遅" });
  assert.equal(stack.status().canUndo, true);
  assert.equal(stack.status().canRedo, false);
});

test("元に戻した後の新しい操作でやり直し履歴を破棄する", () => {
  const stack = createHistoryStack(5);
  stack.record(entry("操作1", 0, 1));
  stack.record(entry("操作2", 1, 2));
  stack.undo();
  assert.equal(stack.status().canRedo, true);

  stack.record(entry("操作3", 1, 3));
  assert.equal(stack.status().canRedo, false);
  assert.equal(stack.status().undoLabel, "操作3");
});

test("履歴件数を上限以内に保つ", () => {
  const stack = createHistoryStack(3);
  stack.record(entry("操作1", 0, 1));
  stack.record(entry("操作2", 1, 2));
  stack.record(entry("操作3", 2, 3));
  stack.record(entry("操作4", 3, 4));

  assert.equal(stack.status().undoCount, 3);
  assert.equal(stack.undo().label, "操作4");
  assert.equal(stack.undo().label, "操作3");
  assert.equal(stack.undo().label, "操作2");
  assert.equal(stack.undo(), null);
});

test("履歴データは呼び出し元と参照を共有しない", () => {
  const stack = createHistoryStack(5);
  const source = entry("従業員編集", { name: "田中" }, { name: "佐藤" });
  stack.record(source);
  source.before.value.name = "変更済み";

  const restored = stack.undo();
  assert.equal(restored.before.value.name, "田中");
  restored.after.value.name = "再変更";
  const redone = stack.redo();
  assert.equal(redone.after.value.name, "佐藤");
});

test("clearで元に戻す履歴とやり直し履歴を消去する", () => {
  const stack = createHistoryStack(5);
  stack.record(entry("操作", 0, 1));
  stack.undo();
  stack.clear();

  assert.equal(stack.status().canUndo, false);
  assert.equal(stack.status().canRedo, false);
});
