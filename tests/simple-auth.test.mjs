import test from "node:test";
import assert from "node:assert/strict";
import { AUTH_CONFIG } from "../js/auth-config.js";
import {
  AUTH_SESSION_KEY,
  authenticatedSession,
  clearAuthenticatedSession,
  storeAuthenticatedSession,
  verifySimpleCredentials
} from "../js/simple-auth.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

test("テスト用の99999で認証し、異なるIDまたはパスワードを拒否する", async () => {
  assert.equal(await verifySimpleCredentials("99999", "99999"), true);
  assert.equal(await verifySimpleCredentials("99998", "99999"), false);
  assert.equal(await verifySimpleCredentials("99999", "99998"), false);
  assert.notEqual(AUTH_CONFIG.password.expectedBase64, "99999");
});

test("同じ認証プロファイルのセッションだけを再利用する", () => {
  const storage = memoryStorage();
  storeAuthenticatedSession(storage, AUTH_CONFIG, "2026-07-18T00:00:00.000Z");
  assert.deepEqual(authenticatedSession(storage), {
    userId: "99999",
    authenticatedAt: "2026-07-18T00:00:00.000Z"
  });

  const changedProfile = { ...AUTH_CONFIG, profileId: "corporate-v1" };
  assert.equal(authenticatedSession(storage, changedProfile), null);
  clearAuthenticatedSession(storage);
  assert.equal(storage.getItem(AUTH_SESSION_KEY), null);
});
