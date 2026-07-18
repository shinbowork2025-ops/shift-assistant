import test from "node:test";
import assert from "node:assert/strict";
import { assertReleaseIntegrity, ReleaseMismatchError } from "../js/release-integrity.js";

test("同じリリース識別子なら起動を許可する", () => {
  assert.equal(assertReleaseIntegrity("2026.07.18.2", "2026.07.18.2"), "2026.07.18.2");
});

test("異なるリリース識別子なら起動を拒否する", () => {
  assert.throws(
    () => assertReleaseIntegrity("2026.07.18.2", "2026.07.18.1"),
    (error) => error instanceof ReleaseMismatchError
      && error.code === "RELEASE_MISMATCH"
      && error.expected === "2026.07.18.2"
      && error.actual === "2026.07.18.1"
  );
});

test("識別子が欠落した場合も起動を拒否する", () => {
  assert.throws(() => assertReleaseIntegrity("2026.07.18.2", ""), ReleaseMismatchError);
});
