export function normalizeManualBreakLocks(candidate) {
  const result = {};
  if (!candidate || typeof candidate !== "object") return result;
  for (const [dateValue, byEmployee] of Object.entries(candidate)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !byEmployee || typeof byEmployee !== "object") continue;
    for (const [employeeId, locked] of Object.entries(byEmployee)) {
      if (!employeeId || !locked) continue;
      result[dateValue] ??= {};
      result[dateValue][employeeId] = true;
    }
  }
  return result;
}

export function isManualBreakLockedInData(data, dateValue, employeeId) {
  return Boolean(data?.[dateValue]?.[employeeId]);
}

export function setManualBreakLockInData(data, dateValue, employeeId, locked) {
  if (locked) {
    data[dateValue] ??= {};
    data[dateValue][employeeId] = true;
    return true;
  }
  if (!data?.[dateValue]?.[employeeId]) return false;
  delete data[dateValue][employeeId];
  if (Object.keys(data[dateValue]).length === 0) delete data[dateValue];
  return false;
}

export function removeManualBreakLocksForEmployee(data, employeeId) {
  let count = 0;
  for (const dateValue of Object.keys(data ?? {})) {
    if (!data[dateValue]?.[employeeId]) continue;
    delete data[dateValue][employeeId];
    count += 1;
    if (Object.keys(data[dateValue]).length === 0) delete data[dateValue];
  }
  return count;
}
