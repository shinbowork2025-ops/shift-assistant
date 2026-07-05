import { SCORE_SLOT_COUNT, SCORE_SLOT_MINUTES } from "./scoring.js";

function requiredAt(requiredCoverage, slot) {
  if (Array.isArray(requiredCoverage)) return Math.max(0, Number(requiredCoverage[slot]) || 0);
  const minute = slot * SCORE_SLOT_MINUTES;
  return Math.max(0, Number(requiredCoverage?.[minute] ?? requiredCoverage?.[String(minute)]) || 0);
}

function rawMetrics(active, load, required) {
  const shortage = Math.max(0, required - (active - load));
  const overlap = Math.max(0, load - 1);
  return {
    understaffing: shortage * shortage,
    concurrentBreaks: overlap * overlap
  };
}

function weighted(raw, weights) {
  const parts = {
    understaffing: raw.understaffing * weights.understaffing,
    concurrentBreaks: raw.concurrentBreaks * weights.concurrentBreaks,
    targetDeviation: raw.targetDeviation * weights.targetDeviation
  };
  return {
    total: parts.understaffing + parts.concurrentBreaks + parts.targetDeviation,
    breakdown: { ...raw, weighted: parts }
  };
}

export function compileRestCandidate(items) {
  const occupied = [];
  let targetDeviation = 0;
  for (const item of items ?? []) {
    const start = Number(item.start);
    const end = Number(item.end);
    const target = Number(item.target);
    const first = Math.max(0, Math.floor(start / SCORE_SLOT_MINUTES));
    const last = Math.min(SCORE_SLOT_COUNT, Math.ceil(end / SCORE_SLOT_MINUTES));
    for (let slot = first; slot < last; slot += 1) occupied.push(slot);
    if (Number.isFinite(target)) targetDeviation += Math.abs(start - target);
  }
  occupied.sort((a, b) => a - b);
  return { items, occupied, targetDeviation };
}

export function evaluateCompiledRest(context, previous, next) {
  const raw = { ...context.raw };
  const slotChanges = [];
  let previousIndex = 0;
  let nextIndex = 0;

  while (previousIndex < previous.occupied.length || nextIndex < next.occupied.length) {
    const previousSlot = previous.occupied[previousIndex] ?? SCORE_SLOT_COUNT;
    const nextSlot = next.occupied[nextIndex] ?? SCORE_SLOT_COUNT;
    if (previousSlot === nextSlot) {
      previousIndex += 1;
      nextIndex += 1;
      continue;
    }
    const slot = Math.min(previousSlot, nextSlot);
    const delta = previousSlot < nextSlot ? -1 : 1;
    if (delta < 0) previousIndex += 1;
    else nextIndex += 1;

    const required = requiredAt(context.requiredCoverage, slot);
    const before = rawMetrics(context.active[slot], context.breakLoad[slot], required);
    const nextLoad = context.breakLoad[slot] + delta;
    const after = rawMetrics(context.active[slot], nextLoad, required);
    raw.understaffing += after.understaffing - before.understaffing;
    raw.concurrentBreaks += after.concurrentBreaks - before.concurrentBreaks;
    slotChanges.push([slot, nextLoad]);
  }

  raw.targetDeviation += next.targetDeviation - previous.targetDeviation;
  return { ...weighted(raw, context.weights), raw, slotChanges };
}

export function applyCompiledRest(context, evaluation) {
  for (const [slot, value] of evaluation.slotChanges) context.breakLoad[slot] = value;
  context.raw = { ...evaluation.raw };
  context.result = { total: evaluation.total, breakdown: evaluation.breakdown };
}
