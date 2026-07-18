import { AUTH_CONFIG } from "./auth-config.js";

export const AUTH_SESSION_KEY = "shift-assistant-auth-session";

function bytesFromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64FromBytes(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function passwordDigest(password, passwordConfig) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password ?? "")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits({
    name: passwordConfig.algorithm,
    hash: passwordConfig.hash,
    iterations: passwordConfig.iterations,
    salt: bytesFromBase64(passwordConfig.saltBase64)
  }, material, 256);
  return base64FromBytes(new Uint8Array(bits));
}

function equalText(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function verifySimpleCredentials(userId, password, config = AUTH_CONFIG) {
  if (String(userId ?? "").trim() !== config.userId) return false;
  const actual = await passwordDigest(password, config.password);
  return equalText(actual, config.password.expectedBase64);
}

export function authenticatedSession(storage = sessionStorage, config = AUTH_CONFIG) {
  try {
    const value = JSON.parse(storage.getItem(AUTH_SESSION_KEY));
    return value?.profileId === config.profileId && value?.userId === config.userId
      ? { userId: value.userId, authenticatedAt: value.authenticatedAt }
      : null;
  } catch {
    return null;
  }
}

export function storeAuthenticatedSession(storage = sessionStorage, config = AUTH_CONFIG, authenticatedAt = new Date().toISOString()) {
  storage.setItem(AUTH_SESSION_KEY, JSON.stringify({
    profileId: config.profileId,
    userId: config.userId,
    authenticatedAt
  }));
}

export function clearAuthenticatedSession(storage = sessionStorage) {
  storage.removeItem(AUTH_SESSION_KEY);
}
