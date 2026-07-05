import { checkHard } from "./scoring.js";

const GRID_MINUTES = 15;

function durationOf(item) {
  return Math.max(0, Number(item.end) - Number(item.start));
}

function patternOptions(spanMinutes) {
  if (spanMinutes <= 240) return [[]];
  if (spanMinutes <= 375) return [[15]];
  if (spanMinutes <= 525) return [[45], [30, 15]];
  return [[15, 60, 15]];
}

function defaultTargets(shiftStart, shiftEnd, durations) {
  const span = shiftEnd - shiftStart;
  if (durations.length === 1 && durations[0] === 15) return [shiftStart + 120];
  if (durations.length === 1) return [shiftStart + Math.round((span - durations[0]) / 2)];
  if (durations.join(",") === "15,60,15") {
    return [
      shiftStart + 120,
      shiftStart + Math.max(180, Math.round((span - 60) / 2)),
      shiftStart + Math.max(300, span - 105)
    ];
  }
  return durations.map((duration, index) => {
    const center = shiftStart + Math.round(span * (index + 1) / (durations.length + 1));
    return center - Math.floor(duration / 2);
  });
}

function metadata(duration, target) {
  return duration <= 15
    ? { type: "small", label: "小休憩", target }
    : { type: "lunch", label: "昼休憩", target };
}

function remainingDurations(option, locked) {
  const remaining = [...option];
  for (const item of locked) {
    const index = remaining.indexOf(durationOf(item));
    if (index < 0) return null;
    remaining.splice(index, 1);
  }
  return remaining;
}

function compatible(candidate, existing, minimumGapMinutes) {
  for (const item of existing) {
    if (candidate.start < item.end && item.start < candidate.end) return false;
    const gap = candidate.end <= item.start
      ? item.start - candidate.end
      : candidate.start - item.end;
    if (gap < minimumGapMinutes) return false;
  }
  return true;
}

export function restSignature(items) {
  return [...items]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((item) => `${item.start}-${item.end}-${item.locked ? 1 : 0}`)
    .join("|");
}

export function restCandidateCacheKey(employee, config = {}) {
  const edge = Math.max(0, Number(config.edgeBufferMinutes ?? 60) || 0);
  const gap = Math.max(0, Number(config.minimumBreakGapMinutes ?? 60) || 0);
  const locked = (employee.breaks ?? []).filter((item) => item.locked);
  return `${employee.shiftStart}:${employee.shiftEnd}:${edge}:${gap}:${employee.fixedBreaks ? 1 : 0}:${restSignature(locked)}`;
}

export function enumerateBreakPatterns(employee, config = {}) {
  if (employee.fixedBreaks) return [(employee.breaks ?? []).map((item) => ({ ...item }))];
  const edge = Math.max(0, Number(config.edgeBufferMinutes ?? 60) || 0);
  const minimumGapMinutes = Math.max(0, Number(config.minimumBreakGapMinutes ?? 60) || 0);
  const shiftStart = Number(employee.shiftStart);
  const shiftEnd = Number(employee.shiftEnd);
  const locked = (employee.breaks ?? []).filter((item) => item.locked).map((item) => ({ ...item }));
  const results = new Map();

  for (const option of patternOptions(shiftEnd - shiftStart)) {
    const remaining = remainingDurations(option, locked);
    if (!remaining) continue;
    const targets = defaultTargets(shiftStart, shiftEnd, remaining);

    function visit(index, placed) {
      if (index >= remaining.length) {
        const complete = [...locked, ...placed].sort((a, b) => a.start - b.start || a.end - b.end);
        results.set(restSignature(complete), complete);
        return;
      }
      const duration = remaining[index];
      const earliest = shiftStart + edge;
      const latest = shiftEnd - edge - duration;
      for (let start = Math.ceil(earliest / GRID_MINUTES) * GRID_MINUTES; start <= latest; start += GRID_MINUTES) {
        const candidate = {
          ...metadata(duration, targets[index]),
          start,
          end: start + duration,
          locked: false
        };
        if (compatible(candidate, [...locked, ...placed], minimumGapMinutes)) {
          visit(index + 1, [...placed, candidate]);
        }
      }
    }

    visit(0, []);
  }

  if (results.size === 0 && checkHard({ employees: [employee] }, config).ok) {
    const current = (employee.breaks ?? []).map((item) => ({ ...item }));
    results.set(restSignature(current), current);
  }
  return [...results.values()].sort((a, b) => restSignature(a).localeCompare(restSignature(b)));
}
