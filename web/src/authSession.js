export const AUTH_SESSION_STORAGE_KEY = "hmos-score-auth-session";
export const AUTH_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "huawei123";

export function verifyCredentials(username, password) {
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

export function createAuthSession(storage, now = Date.now()) {
  storage.setItem(
    AUTH_SESSION_STORAGE_KEY,
    JSON.stringify({
      username: ADMIN_USERNAME,
      expiresAt: now + AUTH_SESSION_DURATION_MS,
    }),
  );
}

export function clearAuthSession(storage) {
  storage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export function isAuthSessionValid(storage, now = Date.now()) {
  const rawSession = storage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!rawSession) {
    return false;
  }

  try {
    const session = JSON.parse(rawSession);
    const valid =
      session &&
      session.username === ADMIN_USERNAME &&
      typeof session.expiresAt === "number" &&
      session.expiresAt > now;
    if (valid) {
      return true;
    }
  } catch {
    clearAuthSession(storage);
    return false;
  }

  clearAuthSession(storage);
  return false;
}
