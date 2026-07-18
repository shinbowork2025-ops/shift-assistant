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

function minimumAdditionalDaysOff(daysInMonth, offDays, maximum) {
  let required = 0;
  let streak = 0;
  for (let day = 1; day <= daysInMonth + 1; day += 1) {
    if (day <= daysInMonth && !offDays.has(day)) {
      streak += 1;
      continue;
    }
    required += Math.floor(streak / (maximum + 1));
    streak = 0;
  }
  return required;
}

function scoreCandidate(candidate, context, selectedDays, needed) {
  const day = candidate.day;
  const tier = context.fixedDays.has(day) ? 0 : context.patternDays.has(day) ? 1 : 2;
  const staffing = (context.dailyOffCounts[day] ?? 0) * 18;
  const distance = nearestDistance(day, context.preferredDays, context.daysInMonth) * 40;
  const changeCost = candidate.code === context.offShiftCode ? -8 : candidate.code ? 10 : 0;
  const adjacent = [day - 1, day + 1]
    .filter((value) => value >= 1 && value <= context.daysInMonth)
    .filter((value) => selectedDays.has(value) || context.preservedOffDays.has(value)).length;
  let streakScore = 0;
  const maximum = Number(context.maxConsecutiveWorkDays) || 0;
  if (maximum > 0) {
    const currentOffDays = new Set([...context.preservedOffDays, ...selectedDays]);
    const currentLongest = longestWorkStreak(context.daysInMonth, currentOffDays);
    const candidateOffDays = new Set([...currentOffDays, day]);
    const candidateLongest = longestWorkStreak(context.daysInMonth, candidateOffDays);
    const currentExcess = Math.max(0, currentLongest - maximum);
    const candidateExcess = Math.max(0, candidateLongest - maximum);
    const remainingSelections = Math.max(0, needed - selectedDays.size - 1);
    const additionalNeeded = minimumAdditionalDaysOff(context.daysInMonth, candidateOffDays, maximum);
    const impossibleWithRemaining = Math.max(0, additionalNeeded - remainingSelections);
    // 上限超過を減らす候補を最優先し、同じ超過量なら最長連勤が短い候補を選ぶ。
    // 残りの公休数だけでは上限を解消できなくなる選択は、先読みして避ける。
    streakScore = impossibleWithRemaining * 10000000
      + (candidateExcess - currentExcess) * 100000
      + additionalNeeded * 10000
      + candidateLongest * 100;
  }
  return streakScore + tier * 1000 + staffing + distance + (tier === 2 ? adjacent * 5 : 0) + changeCost + day / 100;
}

export function chooseDays(candidates, needed, context) {
  const remaining = [...candidates];
  const selectedDays = new Set();
  while (selectedDays.size < needed && remaining.length) {
    remaining.sort((a, b) => scoreCandidate(a, context, selectedDays, needed) - scoreCandidate(b, context, selectedDays, needed));
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
