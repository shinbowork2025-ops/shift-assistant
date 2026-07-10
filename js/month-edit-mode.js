const VALID_MODES = new Set(["normal", "shift-paint", "lock-paint", "off-request-paint"]);
let activeMode = "normal";
const listeners = new Set();
let bootstrapRequested = false;

function requestLockBootstrap() {
  if (bootstrapRequested) return;
  bootstrapRequested = true;
  queueMicrotask(() => {
    void import("./lock-autostart.js");
  });
}

export function getMonthEditMode() {
  requestLockBootstrap();
  return activeMode;
}

export function setMonthEditMode(mode) {
  requestLockBootstrap();
  const nextMode = VALID_MODES.has(mode) ? mode : "normal";
  if (nextMode === activeMode) return activeMode;
  activeMode = nextMode;
  for (const listener of listeners) listener(activeMode);
  return activeMode;
}

export function subscribeMonthEditMode(listener) {
  requestLockBootstrap();
  listeners.add(listener);
  listener(activeMode);
  return () => listeners.delete(listener);
}
