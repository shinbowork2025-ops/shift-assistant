import { dateKey } from "./date-time.js";
import { isShiftLockedInData } from "./shift-locks.js";
import {
  getRestPattern,
  normalizeFixedDaysOff,
  normalizeTargetDaysOff
} from "./rest-patterns.js";
import {
  shiftCodeAt,
  resolvePatternPhase,
  preferredDaySets,
  longestWorkStreak,
  chooseDays
} from "./days-off-planner-core.js";

export function planEmployeeDaysOff(options) {
  const {
    monthValue,
    daysInMonth,
    employee,
    employeeIndex,
    shifts,
    shiftLocks,
    typeMap,
    offShiftCode,
    mode,
    dailyOffCounts
  } = options;
  const pattern = getRestPattern(employee.restPatternId);
  if (!pattern.cycle.length) {
    return {
      changes: [],
      result: {
        employeeId: employee.id,
        employeeName: employee.name,
        patternId: pattern.id,
        patternName: pattern.name,
        skipped: true,
        targetDaysOff: 0,
        actualDaysOff: 0,
        publicDaysOff: 0,
        longestWorkStreak: 0,
        warnings: ["休み方が未設定のため対象外です。"]
      }
    };
  }

  const phase = resolvePatternPhase(employee, employeeIndex, pattern.cycle.length);
  const fixedWeekdays = new Set(normalizeFixedDaysOff(employee.fixedDaysOff));
  const { patternDays, fixedDays, preferredDays } = preferredDaySets(
    monthValue,
    daysInMonth,
    pattern,
    phase,
    fixedWeekdays
  );
  const requestedTarget = normalizeTargetDaysOff(employee.targetDaysOff);
  const targetDaysOff = Math.max(requestedTarget || preferredDays.size, fixedDays.size);
  const warnings = [];
  if (requestedTarget > 0 && requestedTarget < fixedDays.size) {
    warnings.push(`月間公休日数${requestedTarget}日より固定休曜日${fixedDays.size}日の方が多いため、固定休を優先します。`);
  }

  const preservedOffDays = new Set();
  const candidates = [];
  const currentCodes = new Map();
  let lockedPreferredConflicts = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const code = shiftCodeAt(shifts, monthValue, employee.id, day);
    const shiftType = code ? typeMap.get(code) : null;
    const locked = isShiftLockedInData(shiftLocks, monthValue, employee.id, dateKey(monthValue, day));
    const nonWork = Boolean(code && shiftType && !shiftType.isWork);
    const otherNonWork = nonWork && code !== offShiftCode;
    currentCodes.set(day, code);

    if (nonWork && (otherNonWork || locked || mode === "empty-only")) {
      preservedOffDays.add(day);
      continue;
    }
    if (locked) {
      if (preferredDays.has(day)) lockedPreferredConflicts += 1;
      continue;
    }
    if (mode === "empty-only") {
      if (!code) candidates.push({ day, code });
    } else if (!otherNonWork && (!code || code === offShiftCode || shiftType?.isWork)) {
      candidates.push({ day, code });
    }
  }

  if (lockedPreferredConflicts > 0) {
    warnings.push(`希望位置のうち${lockedPreferredConflicts}日はロック済みのため変更していません。`);
  }
  if (preservedOffDays.size > targetDaysOff) {
    warnings.push(`有休などの既存休日が目標${targetDaysOff}日を超えているため、${preservedOffDays.size}日を維持します。`);
  }

  const needed = Math.max(0, targetDaysOff - preservedOffDays.size);
  const selectedDays = chooseDays(candidates, needed, {
    fixedDays,
    patternDays,
    preferredDays,
    dailyOffCounts,
    preservedOffDays,
    daysInMonth,
    offShiftCode
  });
  if (selectedDays.size < needed) {
    warnings.push(`配置可能なセルが不足し、公休を${needed - selectedDays.size}日分配置できませんでした。`);
  }

  const changes = [];
  if (mode === "replace-unlocked") {
    for (let day = 1; day <= daysInMonth; day += 1) {
      const code = currentCodes.get(day) ?? "";
      const locked = isShiftLockedInData(shiftLocks, monthValue, employee.id, dateKey(monthValue, day));
      if (!locked && code === offShiftCode && !selectedDays.has(day)) {
        changes.push({ employeeId: employee.id, employeeName: employee.name, day, before: code, after: "", kind: "clear" });
      }
    }
  }

  for (const day of selectedDays) {
    const before = currentCodes.get(day) ?? "";
    if (before === offShiftCode) continue;
    changes.push({
      employeeId: employee.id,
      employeeName: employee.name,
      day,
      before,
      after: offShiftCode,
      kind: before ? "overwrite" : "place"
    });
  }

  const finalOffDays = new Set([...preservedOffDays, ...selectedDays]);
  const longest = longestWorkStreak(daysInMonth, finalOffDays);
  if (pattern.maxConsecutiveWorkDays > 0 && longest > pattern.maxConsecutiveWorkDays) {
    warnings.push(`未入力日を勤務予定として数えると最大${longest}連勤です（パターン目安${pattern.maxConsecutiveWorkDays}日）。`);
  }

  return {
    changes,
    result: {
      employeeId: employee.id,
      employeeName: employee.name,
      patternId: pattern.id,
      patternName: pattern.name,
      skipped: false,
      phase,
      targetDaysOff,
      actualDaysOff: finalOffDays.size,
      publicDaysOff: selectedDays.size,
      longestWorkStreak: longest,
      warnings
    }
  };
}
