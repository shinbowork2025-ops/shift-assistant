import { getDaysInMonth, isMonthValue } from "./date-time.js";

function isDateInMonth(dateValue, monthValue) {
  if (typeof dateValue !== "string" || !dateValue.startsWith(`${monthValue}-`)) return false;
  const day = Number(dateValue.slice(-2));
  return Number.isInteger(day) && day >= 1 && day <= getDaysInMonth(monthValue);
}

function cleanup(data, monthValue, employeeId) {
  const employeeRequests = data[monthValue]?.[employeeId];
  if (employeeRequests && Object.keys(employeeRequests).length === 0) delete data[monthValue][employeeId];
  if (data[monthValue] && Object.keys(data[monthValue]).length === 0) delete data[monthValue];
}

export function normalizeDayOffRequests(candidate) {
  const result = {};
  if (!candidate || typeof candidate !== "object") return result;

  for (const [monthValue, monthRequests] of Object.entries(candidate)) {
    if (!isMonthValue(monthValue) || !monthRequests || typeof monthRequests !== "object") continue;
    for (const [employeeId, employeeRequests] of Object.entries(monthRequests)) {
      if (!employeeId || !employeeRequests || typeof employeeRequests !== "object") continue;
      for (const [dateValue, requested] of Object.entries(employeeRequests)) {
        if (requested !== true || !isDateInMonth(dateValue, monthValue)) continue;
        result[monthValue] ??= {};
        result[monthValue][employeeId] ??= {};
        result[monthValue][employeeId][dateValue] = true;
      }
    }
  }
  return result;
}

export function isDayOffRequestedInData(data, monthValue, employeeId, dateValue) {
  return data?.[monthValue]?.[employeeId]?.[dateValue] === true;
}

export function setDayOffRequestInData(data, monthValue, employeeId, dateValue, requested) {
  if (!isMonthValue(monthValue) || !employeeId || !isDateInMonth(dateValue, monthValue)) return false;
  if (requested) {
    data[monthValue] ??= {};
    data[monthValue][employeeId] ??= {};
    data[monthValue][employeeId][dateValue] = true;
  } else {
    delete data[monthValue]?.[employeeId]?.[dateValue];
    cleanup(data, monthValue, employeeId);
  }
  return Boolean(requested);
}

export function requestedDaysForEmployee(data, monthValue, employeeId) {
  return Object.keys(data?.[monthValue]?.[employeeId] ?? {})
    .filter((dateValue) => data[monthValue][employeeId][dateValue] === true)
    .sort();
}

export function clearMonthDayOffRequests(data, monthValue) {
  const count = Object.values(data?.[monthValue] ?? {})
    .reduce((sum, employeeRequests) => sum + Object.keys(employeeRequests ?? {}).length, 0);
  delete data[monthValue];
  return count;
}

export function removeEmployeeDayOffRequests(data, employeeId) {
  let count = 0;
  for (const monthValue of Object.keys(data)) {
    count += Object.keys(data[monthValue]?.[employeeId] ?? {}).length;
    delete data[monthValue]?.[employeeId];
    if (data[monthValue] && Object.keys(data[monthValue]).length === 0) delete data[monthValue];
  }
  return count;
}
