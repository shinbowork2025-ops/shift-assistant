export const BREAK_GRID_MINUTES = 15;

export function breakSlots(start, duration) {
  const result = [];
  const end = start + duration;
  for (let minute = Math.floor(start / BREAK_GRID_MINUTES) * BREAK_GRID_MINUTES; minute < end; minute += BREAK_GRID_MINUTES) {
    result.push(minute);
  }
  return result;
}

export function nearbyStarts(target, earliest, latest) {
  const result = [];
  for (let offset = -60; offset <= 60; offset += BREAK_GRID_MINUTES) {
    const candidate = Math.round((target + offset) / BREAK_GRID_MINUTES) * BREAK_GRID_MINUTES;
    if (candidate >= earliest && candidate <= latest && !result.includes(candidate)) result.push(candidate);
  }
  if (result.length === 0) {
    result.push(Math.min(latest, Math.max(earliest, Math.round(target / BREAK_GRID_MINUTES) * BREAK_GRID_MINUTES)));
  }
  return result;
}
