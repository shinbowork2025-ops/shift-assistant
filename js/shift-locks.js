export function normalizeShiftLocks(candidate) {
  const result = {};
  if (!candidate || typeof candidate !== "object") return result;

  for (const [monthValue, monthLocks] of Object.entries(candidate)) {
    if (!/^\d{4}-\d{2}$/.test(monthValue) || !monthLocks || typeof monthLocks !== "object") continue;
    for (const [employeeId, employeeLocks] of Object.entries(monthLocks)) {
      if (!employeeId || !employeeLocks || typeof employeeLocks !== "object") continue;
      for (const [dateValue, locked] of Object.entries(employeeLocks)) {
        if (locked !== true || !dateValue.startsWith(`${monthValue}-`)) continue;
        result[monthValue] ??= {};
        result[monthValue][employeeId] ??= {};
        result[monthValue][employeeId][dateValue] = true;
      }
    }
  }
  return result;
}

export function isShiftLockedInData(shiftLocks, monthValue, employeeId, dateValue) {
  return shiftLocks?.[monthValue]?.[employeeId]?.[dateValue] === true;
}

function removeEmptyContainers(shiftLocks, monthValue, employeeId) {
  const employeeLocks = shiftLocks?.[monthValue]?.[employeeId];
  if (employeeLocks && Object.keys(employeeLocks).length === 0) delete shiftLocks[monthValue][employeeId];
  if (shiftLocks?.[monthValue] && Object.keys(shiftLocks[monthValue]).length === 0) delete shiftLocks[monthValue];
}

export function setShiftLockInData(shiftLocks, monthValue, employeeId, dateValue, locked) {
  if (locked) {
    shiftLocks[monthValue] ??= {};
    shiftLocks[monthValue][employeeId] ??= {};
    shiftLocks[monthValue][employeeId][dateValue] = true;
  } else {
    delete shiftLocks?.[monthValue]?.[employeeId]?.[dateValue];
    removeEmptyContainers(shiftLocks, monthValue, employeeId);
  }
  return Boolean(locked);
}

export function clearMonthShiftLocks(shiftLocks, monthValue) {
  const count = Object.values(shiftLocks?.[monthValue] ?? {})
    .reduce((sum, employeeLocks) => sum + Object.keys(employeeLocks ?? {}).length, 0);
  delete shiftLocks?.[monthValue];
  return count;
}

export function removeEmployeeShiftLocks(shiftLocks, employeeId) {
  let count = 0;
  for (const monthValue of Object.keys(shiftLocks ?? {})) {
    count += Object.keys(shiftLocks[monthValue]?.[employeeId] ?? {}).length;
    delete shiftLocks[monthValue]?.[employeeId];
    if (Object.keys(shiftLocks[monthValue] ?? {}).length === 0) delete shiftLocks[monthValue];
  }
  return count;
}
