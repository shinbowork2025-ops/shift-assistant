import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryPatch, applyHistoryPatch } from "../js/history-patch.js";

test("単一シフト変更を葉の差分だけで保持する", () => {
  const before = {
    workspaceId: "w1",
    shifts: { "2026-07": { e1: { "2026-07-01": "early" } } },
    breaks: {}
  };
  const after = structuredClone(before);
  after.shifts["2026-07"].e1["2026-07-01"] = "late";

  const patch = createHistoryPatch(before, after);
  assert.equal(patch.length, 1);
  assert.deepEqual(patch[0].path, ["shifts", "2026-07", "e1", "2026-07-01"]);

  const restored = applyHistoryPatch(structuredClone(after), patch, "before");
  assert.deepEqual(restored, before);
  const redone = applyHistoryPatch(restored, patch, "after");
  assert.deepEqual(redone, after);
});

test("新しい枝の追加と削除を往復できる", () => {
  const before = { shifts: {} };
  const after = { shifts: { "2026-07": { e1: { "2026-07-01": "early" } } } };
  const patch = createHistoryPatch(before, after);

  assert.equal(patch.length, 1);
  assert.deepEqual(patch[0].path, ["shifts", "2026-07"]);
  assert.deepEqual(applyHistoryPatch(structuredClone(before), patch, "after"), after);
  assert.deepEqual(applyHistoryPatch(structuredClone(after), patch, "before"), before);
});

test("配列変更は配列単位で安全に保持する", () => {
  const before = { employees: [{ id: "e1", name: "田中" }] };
  const after = { employees: [{ id: "e1", name: "田中" }, { id: "e2", name: "佐藤" }] };
  const patch = createHistoryPatch(before, after);

  assert.equal(patch.length, 1);
  assert.deepEqual(patch[0].path, ["employees"]);
  const applied = applyHistoryPatch(structuredClone(before), patch, "after");
  applied.employees[0].name = "変更";
  assert.equal(patch[0].after.value[0].name, "田中");
});

test("変更がない場合は空の差分を返す", () => {
  const document = { name: "園芸", shifts: {} };
  assert.deepEqual(createHistoryPatch(document, structuredClone(document)), []);
});
