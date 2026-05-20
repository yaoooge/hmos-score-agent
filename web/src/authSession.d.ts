export const AUTH_SESSION_STORAGE_KEY: "hmos-score-auth-session";
export const AUTH_SESSION_DURATION_MS: number;

export function verifyCredentials(username: string, password: string): boolean;
export function createAuthSession(storage: Storage, now?: number): void;
export function clearAuthSession(storage: Storage): void;
export function isAuthSessionValid(storage: Storage, now?: number): boolean;
