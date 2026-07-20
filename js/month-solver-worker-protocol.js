import { SOLVER_CONFIG_VERSION } from "./solver/solver-config.js";

function canonicalValue(value) {
  if (value === null || typeof value !== "object") {
    return Number.isFinite(value) || typeof value !== "number" ? value : null;
  }
  if (ArrayBuffer.isView(value)) return [...value].map(canonicalValue);
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value instanceof Set) return [...value].map(canonicalValue).sort();
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()]
      .map(([key, item]) => [String(key), canonicalValue(item)])
      .sort(([left], [right]) => left.localeCompare(right)));
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

export function stableSolverStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

export function createSolverInputFingerprint(planSnapshot) {
  const text = stableSolverStringify(planSnapshot);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v${SOLVER_CONFIG_VERSION}-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}

export function createSolverShiftChanges(plan) {
  const selected = new Set(plan?.selectedEmployeeIds ?? []);
  const changes = [];
  for (const employee of plan?.employees ?? []) {
    if (!selected.has(employee.id)) continue;
    for (let day = 1; day <= (plan?.daysInMonth ?? 0); day += 1) {
      const before = plan?.originalAssignments?.[employee.id]?.[day] ?? "";
      const after = plan?.assignments?.[employee.id]?.[day] ?? "";
      if (before !== after) changes.push({ employeeId: employee.id, day, before, after });
    }
  }
  return changes;
}

export function createSolverBreakChanges(initialBreaks = {}, finalBreaks = {}, forcedKeys = []) {
  const changes = [];
  const forced = new Set(forcedKeys);
  const dates = [...new Set([...Object.keys(initialBreaks ?? {}), ...Object.keys(finalBreaks ?? {})])]
    .sort();
  for (const date of dates) {
    const employeeIds = [...new Set([
      ...Object.keys(initialBreaks?.[date] ?? {}),
      ...Object.keys(finalBreaks?.[date] ?? {})
    ])].sort();
    for (const employeeId of employeeIds) {
      const before = structuredClone(initialBreaks?.[date]?.[employeeId] ?? []);
      const after = structuredClone(finalBreaks?.[date]?.[employeeId] ?? []);
      if (stableSolverStringify(before) === stableSolverStringify(after)
        && !forced.has(`${date}:${employeeId}`)) continue;
      changes.push({ date, employeeId, before, after });
    }
  }
  return changes;
}

export function createEstimateMetrics(estimatedSlots, finalSlots) {
  const estimated = Array.isArray(estimatedSlots) || ArrayBuffer.isView(estimatedSlots)
    ? [...estimatedSlots].map((value) => Math.max(0, Number(value) || 0))
    : [Math.max(0, Number(estimatedSlots) || 0)];
  const final = Array.isArray(finalSlots) || ArrayBuffer.isView(finalSlots)
    ? [...finalSlots].map((value) => Math.max(0, Number(value) || 0))
    : [Math.max(0, Number(finalSlots) || 0)];
  const length = Math.max(estimated.length, final.length);
  let estimatedShortagePersonSlots = 0;
  let finalShortagePersonSlots = 0;
  let underestimatedPersonSlots = 0;
  let overestimatedPersonSlots = 0;
  let maximumSlotUnderestimate = 0;
  let maximumSlotOverestimate = 0;
  let absoluteError = 0;
  for (let index = 0; index < length; index += 1) {
    const estimatedValue = estimated[index] ?? 0;
    const finalValue = final[index] ?? 0;
    const underestimate = Math.max(0, finalValue - estimatedValue);
    const overestimate = Math.max(0, estimatedValue - finalValue);
    estimatedShortagePersonSlots += estimatedValue;
    finalShortagePersonSlots += finalValue;
    underestimatedPersonSlots += underestimate;
    overestimatedPersonSlots += overestimate;
    maximumSlotUnderestimate = Math.max(maximumSlotUnderestimate, underestimate);
    maximumSlotOverestimate = Math.max(maximumSlotOverestimate, overestimate);
    absoluteError += Math.abs(finalValue - estimatedValue);
  }
  return {
    estimatedShortagePersonSlots,
    finalShortagePersonSlots,
    underestimatedPersonSlots,
    overestimatedPersonSlots,
    maximumSlotUnderestimate,
    maximumSlotOverestimate,
    meanAbsoluteSlotError: length ? absoluteError / length : 0
  };
}

export function createWorkerProgressMessage(metadata, progress) {
  const message = {
    type: "progress",
    completedBlocks: Number(progress?.completedBlocks) || 0,
    generatedCandidates: Number(progress?.generatedCandidates) || 0,
    acceptedCandidates: Number(progress?.acceptedCandidates ?? progress?.accepted) || 0,
    bestEstimatedScore: Number(progress?.bestEstimatedScore ?? progress?.bestObjective?.scalar) || 0,
    statutoryViolationCount: Number(progress?.statutoryViolationCount) || 0,
    internalViolationCount: Number(progress?.internalViolationCount) || 0,
    estimatedShortagePersonSlots: Number(progress?.estimatedShortagePersonSlots) || 0,
    temperature: Number(progress?.temperature) || 0,
    progress: structuredClone(progress ?? {})
  };
  if (metadata?.scheduleRevision !== undefined) message.scheduleRevision = metadata.scheduleRevision;
  if (metadata?.inputFingerprint) message.inputFingerprint = metadata.inputFingerprint;
  return message;
}

export function createWorkerResultMessage(metadata, solverResult, solverConfig = {}) {
  const estimatedShortage = Number(solverResult?.objective?.shortagePeople) || 0;
  const finalShortage = Number(solverResult?.finalShortagePersonSlots ?? estimatedShortage) || 0;
  const estimateMetrics = solverResult?.estimateMetrics
    ? structuredClone(solverResult.estimateMetrics)
    : createEstimateMetrics(estimatedShortage, finalShortage);
  const shiftChanges = createSolverShiftChanges(solverResult?.plan);
  const forcedBreakKeys = shiftChanges.map((change) => {
    const date = `${solverResult.plan.monthValue}-${String(change.day).padStart(2, "0")}`;
    return `${date}:${change.employeeId}`;
  });
  const breakChanges = createSolverBreakChanges(
    solverResult?.plan?.breaks,
    solverResult?.finalBreaks,
    forcedBreakKeys
  );
  return {
    type: "result",
    scheduleRevision: metadata?.scheduleRevision ?? null,
    inputFingerprint: metadata?.inputFingerprint ?? "",
    shiftChanges,
    breakChanges,
    manualBreakLockChanges: structuredClone(solverResult?.manualBreakLockChanges ?? []),
    resultSummary: {
      classification: solverResult?.classification ?? "invalid",
      estimatedScore: Number(solverResult?.objective?.scalar) || 0,
      statutoryViolationCount: Number(solverResult?.objective?.statutoryViolationCount) || 0,
      statutoryViolationAmount: Number(solverResult?.objective?.statutoryViolationAmount) || 0,
      internalViolationCount: Number(solverResult?.objective?.internalViolationCount) || 0,
      estimatedShortagePersonSlots: estimatedShortage,
      finalShortagePersonSlots: finalShortage,
      finalAttributeShortagePersonSlots: Number(solverResult?.finalAttributeShortagePersonSlots) || 0,
      changedCellCount: shiftChanges.length,
      changedBreakCount: breakChanges.length
    },
    estimateMetrics,
    statistics: structuredClone(solverResult?.statistics ?? {}),
    solverConfigSnapshot: {
      solverConfigVersion: SOLVER_CONFIG_VERSION,
      ...structuredClone(solverConfig)
    },
    // PR1で差分適用へ完全移行するまで、現行プレビュー用の結果も保持する。
    result: solverResult
  };
}
