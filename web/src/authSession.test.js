import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_SESSION_DURATION_MS,
  AUTH_SESSION_STORAGE_KEY,
  clearAuthSession,
  createAuthSession,
  isAuthSessionValid,
  verifyCredentials,
} from "./authSession.js";

function createMemoryStorage(initialValue) {
  const values = new Map();
  if (initialValue !== undefined) {
    values.set(AUTH_SESSION_STORAGE_KEY, initialValue);
  }

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("verifyCredentials accepts only the default admin account", () => {
  assert.equal(verifyCredentials("admin", "huawei123"), true);
  assert.equal(verifyCredentials("admin", "wrong-password"), false);
  assert.equal(verifyCredentials("other", "huawei123"), false);
});

test("createAuthSession stores a seven-day local session", () => {
  const storage = createMemoryStorage();
  const now = new Date("2026-05-20T00:00:00.000Z").getTime();

  createAuthSession(storage, now);

  assert.deepEqual(JSON.parse(storage.getItem(AUTH_SESSION_STORAGE_KEY)), {
    username: "admin",
    expiresAt: now + AUTH_SESSION_DURATION_MS,
  });
});

test("isAuthSessionValid returns true before expiry", () => {
  const now = new Date("2026-05-20T00:00:00.000Z").getTime();
  const storage = createMemoryStorage(
    JSON.stringify({ username: "admin", expiresAt: now + AUTH_SESSION_DURATION_MS }),
  );

  assert.equal(isAuthSessionValid(storage, now + AUTH_SESSION_DURATION_MS - 1), true);
});

test("isAuthSessionValid removes expired or malformed sessions", () => {
  const now = new Date("2026-05-20T00:00:00.000Z").getTime();
  const expiredStorage = createMemoryStorage(JSON.stringify({ username: "admin", expiresAt: now - 1 }));
  const malformedStorage = createMemoryStorage("not-json");

  assert.equal(isAuthSessionValid(expiredStorage, now), false);
  assert.equal(expiredStorage.getItem(AUTH_SESSION_STORAGE_KEY), null);
  assert.equal(isAuthSessionValid(malformedStorage, now), false);
  assert.equal(malformedStorage.getItem(AUTH_SESSION_STORAGE_KEY), null);
});

test("clearAuthSession removes the stored session", () => {
  const storage = createMemoryStorage(JSON.stringify({ username: "admin", expiresAt: 1 }));

  clearAuthSession(storage);

  assert.equal(storage.getItem(AUTH_SESSION_STORAGE_KEY), null);
});
