export const FEASIBLE_ARCHIVE_SIZE = 5;
export const REPAIRABLE_ARCHIVE_SIZE = 5;

function clone(value) {
  return structuredClone(value);
}

function violationValue(objective, key) {
  return Math.max(0, Number(objective?.[key]) || 0);
}

export function classifyEstimatedCandidate(objective) {
  return violationValue(objective, "statutoryViolationCount") === 0
    && violationValue(objective, "internalViolationCount") === 0
    ? "feasible"
    : "repairable";
}

function assignmentSignature(plan, changes = []) {
  const overrides = new Map(changes.map((change) => [
    `${change.employeeId}:${change.day}`,
    change.after
  ]));
  const parts = [];
  const selected = new Set(plan.selectedEmployeeIds ?? plan.employees?.map((employee) => employee.id));
  for (const employee of plan.employees ?? []) {
    if (!selected.has(employee.id)) continue;
    for (let day = 1; day <= (plan.daysInMonth ?? 0); day += 1) {
      const key = `${employee.id}:${day}`;
      parts.push(`${key}=${overrides.has(key) ? overrides.get(key) : plan.assignments?.[employee.id]?.[day] ?? ""}`);
    }
  }
  return parts.join("|");
}

function changedCellCount(plan, changes = []) {
  const overrides = new Map(changes.map((change) => [
    `${change.employeeId}:${change.day}`,
    change.after
  ]));
  let count = 0;
  const selected = new Set(plan.selectedEmployeeIds ?? plan.employees?.map((employee) => employee.id));
  for (const employee of plan.employees ?? []) {
    if (!selected.has(employee.id)) continue;
    for (let day = 1; day <= (plan.daysInMonth ?? 0); day += 1) {
      const key = `${employee.id}:${day}`;
      const current = overrides.has(key) ? overrides.get(key) : plan.assignments?.[employee.id]?.[day] ?? "";
      if (current !== (plan.originalAssignments?.[employee.id]?.[day] ?? "")) count += 1;
    }
  }
  return count;
}

function estimatedShortageBySlot(dayMetrics) {
  if (!(dayMetrics instanceof Map)) return [];
  return [...dayMetrics.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .flatMap(([, metric]) => [...(metric?.shortageBySlot ?? [])]);
}

function applyChanges(plan, changes) {
  const result = clone(plan);
  for (const change of changes ?? []) {
    result.assignments[change.employeeId][change.day] = change.after;
  }
  return result;
}

export function compareArchivedCandidates(first, second) {
  const keys = [
    "statutoryViolationCount",
    "statutoryViolationAmount",
    "internalViolationCount",
    "internalViolationAmount"
  ];
  for (const key of keys) {
    const difference = violationValue(first.objective, key) - violationValue(second.objective, key);
    if (difference !== 0) return difference;
  }
  const scoreDifference = Number(first.objective?.scalar) - Number(second.objective?.scalar);
  if (scoreDifference !== 0) return scoreDifference;
  if (first.changedCellCount !== second.changedCellCount) {
    return first.changedCellCount - second.changedCellCount;
  }
  return first.signature.localeCompare(second.signature);
}

export function createCandidateArchives(options = {}) {
  return {
    feasible: [],
    repairable: [],
    feasibleLimit: Math.max(1, Number(options.feasibleLimit) || FEASIBLE_ARCHIVE_SIZE),
    repairableLimit: Math.max(1, Number(options.repairableLimit) || REPAIRABLE_ARCHIVE_SIZE),
    signatures: new Set(),
    considered: 0,
    duplicates: 0
  };
}

export function considerCandidate(archives, input) {
  archives.considered += 1;
  const changes = input.changes ?? [];
  const signature = assignmentSignature(input.plan, changes);
  if (archives.signatures.has(signature)) {
    archives.duplicates += 1;
    return false;
  }
  const classification = classifyEstimatedCandidate(input.objective);
  const target = archives[classification];
  const limit = classification === "feasible" ? archives.feasibleLimit : archives.repairableLimit;
  const descriptor = {
    signature,
    objective: clone(input.objective),
    changedCellCount: changedCellCount(input.plan, changes)
  };
  if (target.length >= limit && compareArchivedCandidates(descriptor, target.at(-1)) >= 0) return false;

  const candidate = {
    ...descriptor,
    classification,
    plan: applyChanges(input.plan, changes),
    estimatedShortageBySlot: estimatedShortageBySlot(input.dayMetrics)
  };
  target.push(candidate);
  target.sort(compareArchivedCandidates);
  if (target.length > limit) {
    const removed = target.pop();
    archives.signatures.delete(removed.signature);
  }
  archives.signatures.add(signature);
  return true;
}

export function archivedCandidates(archives) {
  return [...archives.feasible, ...archives.repairable];
}

export function archiveStatistics(archives) {
  return {
    consideredCandidates: archives.considered,
    duplicateCandidates: archives.duplicates,
    feasibleArchiveSize: archives.feasible.length,
    repairableArchiveSize: archives.repairable.length
  };
}
