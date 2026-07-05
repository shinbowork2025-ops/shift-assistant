import { plannedBreakTemplates } from "./break-rules.js";
import { breakSlots, nearbyStarts } from "./break-grid.js";

function addLoad(items, load) {
  for (const item of items ?? []) {
    const duration = Number(item.end) - Number(item.start);
    for (const slot of breakSlots(Number(item.start), duration)) {
      load.set(slot, (load.get(slot) ?? 0) + 1);
    }
  }
}

function chooseStart(target, earliest, latest, duration, active, load) {
  let best = earliest;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const start of nearbyStarts(target, earliest, latest)) {
    let minimumAvailable = Number.POSITIVE_INFINITY;
    let concurrent = 0;
    for (const slot of breakSlots(start, duration)) {
      minimumAvailable = Math.min(minimumAvailable, (active.get(slot) ?? 0) - (load.get(slot) ?? 0) - 1);
      concurrent += load.get(slot) ?? 0;
    }
    const candidateScore = -minimumAvailable * 1000 + concurrent * 100 + Math.abs(start - target);
    if (candidateScore < bestScore) {
      best = start;
      bestScore = candidateScore;
    }
  }
  return best;
}

export function generateGreedyRestPlan(dayPlan) {
  const employees = Array.isArray(dayPlan?.employees) ? dayPlan.employees : [];
  const result = {};
  for (const employee of employees) result[employee.id] = [];
  return result;
}
