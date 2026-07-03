const VALID_MODES = new Set(["normal", "shift-paint", "lock-paint"]);
let activeMode = "normal";
const listeners = new Set();

export function getMonthEditMode() {
  return activeMode;
}

export function setMonthEditMode(mode) {
  const nextMode = VALID_MODES.has(mode) ? mode : "normal";
  if (nextMode === activeMode) return activeMode;
  activeMode = nextMode;
  for (const listener of listeners) listener(activeMode);
  return activeMode;
}

export function subscribeMonthEditMode(listener) {
  listeners.add(listener);
  listener(activeMode);
  return () => listeners.delete(listener);
}
