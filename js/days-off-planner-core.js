import { dateKey } from "./date-time.js";
import { isShiftLockedInData } from "./shift-locks.js";
import { normalizeRestPatternOffset } from "./rest-patterns.js";

export function createShiftTypeMap(shiftTypes) {
  return new Map((Array.isArray(shiftTypes) ? shiftTypes : []).map((item) => [item.code, item]));
}

export function shiftCodeAt(shifts, monthValue, employeeId, day) {
  return shifts?.[monthValue]?.[employeeId]?.[dateKey(monthValue, day)] ?? "";
}

export function dayOfWeek(monthValue, day) {
  const [year, month] = monthValue.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

export function resolvePatternPhase(employee, employeeIndex, cycleLength) {
  if (cycleLength <= 0) return 0;
  const configured = normalizeRestPatternOffset(employee?.restPatternOffset);
  return configured >= 0 ? configured % cycleLength : employeeIndex % cycleLength;
}

export function preferredDaySets(monthValue, daysInMonth, pattern, phase, fixedWeekdays) {
  const patternDays = new Set();
  const fixedDays = new Set();
  for (let day = 1; day <= daysInMonth; day += 1) {
    if (pattern.cycle[(day - 1 + phase) % pattern.cycle.length] === "off") patternDays.add(day);
    if (fixedWeekdays.has(dayOfWeek(monthValue, day))) fixedDays.add(day);
  }
  return {
    patternDays,
    fixedDays,
    preferredDays: new Set([...patternDays, ...fixedDays])
  };
}

export function longestWorkStreak(daysInMonth, offDays) {
  let longest = 0;
  let current = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    if (offDays.has(day)) current = 0;
    else {
      current += 1;
      longest = Math.max(longest, current);
    }
  }
  return longest;
}

function nearestDistance(day, preferredDays, daysInMonth) {
  if (!preferredDays.size) return daysInMonth;
  let distance = daysInMonth;
  for (const preferredDay of preferredDays) distance = Math.min(distance, Math.abs(day - preferredDay));
  return distance;
}

function scoreCandidate(candidate, context, selectedDays) {
  const day = candidate.day;
  const tier = context.fixedDays.has(day) ? 0 : context.patternDays.has(day) ? 1 : 2;
  const staffing = (context.dailyOffCounts[day] ?? 0) * 18;
  const distance = nearestDistance(day, context.preferredDays, context.daysInMonth) * 40;
  const changeCost = candidate.code === context.offShiftCode ? -8 : candidate.code ? 10 : 0;
  const adjacent = [day - 1, day + 1]
    .filter((value) => value >= 1 && value <= context.daysInMonth)
    .filter((value) => selectedDays.has(value) || context.preservedOffDays.has(value)).length;
  return tier * 1000 + staffing + distance + (tier === 2 ? adjacent * 5 : 0) + changeCost + day / 100;
}

export function chooseDays(candidates, needed, context) {
  const remaining = [...candidates];
  const selectedDays = new Set();
  while (selectedDays.size < needed && remaining.length) {
    remaining.sort((a, b) => scoreCandidate(a, context, selectedDays) - scoreCandidate(b, context, selectedDays));
    const chosen = remaining.shift();
    selectedDays.add(chosen.day);
    context.dailyOffCounts[chosen.day] = (context.dailyOffCounts[chosen.day] ?? 0) + 1;
  }
  return selectedDays;
}

export function createInitialOffCounts(options) {
  const counts = Array.from({ length: options.daysInMonth + 1 }, () => 0);
  for (const employee of options.employees) {
    for (let day = 1; day <= options.daysInMonth; day += 1) {
      const code = shiftCodeAt(options.shifts, options.monthValue, employee.id, day);
      const shiftType = options.typeMap.get(code);
      if (!code || !shiftType || shiftType.isWork) continue;
      const locked = isShiftLockedInData(
        options.shiftLocks,
        options.monthValue,
        employee.id,
        dateKey(options.monthValue, day)
      );
      if (code !== options.offShiftCode || locked || options.mode === "empty-only") counts[day] += 1;
    }
  }
  return counts;
}
