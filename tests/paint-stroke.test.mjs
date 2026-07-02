import test from "node:test";
import assert from "node:assert/strict";
import { createPaintStroke } from "../js/paint-stroke.js";

test("同じセルを複数回通っても1回だけ処理する", () => {
  const applied = [];
  const stroke = createPaintStroke((payload) => {
    applied.push(payload);
    return true;
  });

  assert.equal(stroke.visit("e1:1", { employeeId: "e1", day: 1 }), true);
  assert.equal(stroke.visit("e1:1", { employeeId: "e1", day: 1 }), false);
  assert.equal(stroke.visit("e1:2", { employeeId: "e1", day: 2 }), true);

  assert.equal(applied.length, 2);
  assert.deepEqual(stroke.summary(), { visitedCount: 2, changedCount: 2 });
});

test("値が変わらなかったセルは訪問数だけ増え変更数に含めない", () => {
  const stroke = createPaintStroke((payload) => payload.changed);
  stroke.visit("e1:1", { changed: false });
  stroke.visit("e1:2", { changed: true });
  stroke.visit("e1:3", { changed: false });

  assert.deepEqual(stroke.summary(), { visitedCount: 3, changedCount: 1 });
});

test("空のキーは処理しない", () => {
  let calls = 0;
  const stroke = createPaintStroke(() => {
    calls += 1;
    return true;
  });

  assert.equal(stroke.visit("", {}), false);
  assert.equal(stroke.visit(null, {}), false);
  assert.equal(calls, 0);
  assert.deepEqual(stroke.summary(), { visitedCount: 0, changedCount: 0 });
});
