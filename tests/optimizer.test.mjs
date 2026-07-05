import test from "node:test";
import assert from "node:assert/strict";
import { optimizeBreaks } from "../js/optimizer.js";

test("optimizer smoke", () => {
  const result = optimizeBreaks({ employees: [] }, { seed: 1 });
  assert.equal(result.score, 0);
});
