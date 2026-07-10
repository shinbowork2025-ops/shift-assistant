function cleanText(value, maxLength = 30) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeRequestedDaysOff(candidate) {
  const result = {};
  if (!candidate || typeof candidate !== "object") return result;
  for (const [monthValue, byEmployee] of Object.entries(candidate)) {
    if (!/^\d{4}-\d{2}$/.test(monthValue) || !byEmployee || typeof byEmployee !== "object") continue;
    for (const [employeeId, byDate] of Object.entries(byEmployee)) {
      if (!employeeId || !byDate || typeof byDate !== "object") continue;
      for (const [dateValue, marker] of Object.entries(byDate)) {
        if (!dateValue.startsWith(`${monthValue}-`)) continue;
        const shiftCode = cleanText(marker?.shiftCode ?? marker);
        if (!shiftCode) continue;
        result[monthValue] ??= {};
        result[monthValue][employeeId] ??= {};
        result[monthValue][employeeId][dateValue] = { shiftCode };
      }
    }
  }
  return result;
}

export function getRequestedDayOffInData(data, monthValue, employeeId, dateValue) {
  return data?.[monthValue]?.[employeeId]?.[dateValue] ?? null;
}

export function isRequestedDayOffInData(data, monthValue, employeeId, dateValue) {
  return Boolean(getRequestedDayOffInData(data, monthValue, employeeId, dateValue));
}

export function setRequestedDayOffInData(data, monthValue, employeeId, dateValue, shiftCode) {
  const code = cleanText(shiftCode);
  if (!code) return false;
  data[monthValue] ??= {};
  data[monthValue][employeeId] ??= {};
  data[monthValue][employeeId][dateValue] = { shiftCode: code };
  return true;
}

export function removeRequestedDayOffInData(data, monthValue, employeeId, dateValue) {
  if (!data?.[monthValue]?.[employeeId]?.[dateValue]) return false;
  delete data[monthValue][employeeId][dateValue];
  if (Object.keys(data[monthValue][employeeId]).length === 0) delete data[monthValue][employeeId];
  if (Object.keys(data[monthValue]).length === 0) delete data[monthValue];
  return true;
}

export function clearRequestedDaysOffForMonth(data, monthValue) {
  const count = Object.values(data?.[monthValue] ?? {}).reduce(
    (sum, byDate) => sum + Object.keys(byDate ?? {}).length,
    0
  );
  if (data?.[monthValue]) delete data[monthValue];
  return count;
}

export function removeRequestedDaysOffForEmployee(data, employeeId) {
  let count = 0;
  for (const monthValue of Object.keys(data ?? {})) {
    const byDate = data[monthValue]?.[employeeId];
    if (!byDate) continue;
    count += Object.keys(byDate).length;
    delete data[monthValue][employeeId];
    if (Object.keys(data[monthValue]).length === 0) delete data[monthValue];
  }
  return count;
}
