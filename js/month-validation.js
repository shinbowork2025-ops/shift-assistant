import { buildDailyOverview } from "./daily-overview.js";
import { dateKey, getDaysInMonth, timeToMinutes } from "./date-time.js";
import { getRestPattern } from "./rest-patterns.js";
import { isShiftLockedInData } from "./shift-locks.js";
import { getRequestedDayOffInData } from "./requested-days-off.js";
import { isManualBreakLockedInData } from "./manual-break-locks.js";
import { overtimeMinutesForShift } from "./shift-metrics.js";
import { restGapMinutes } from "./work-shift-planner-core.js";

const MINIMUM_REST_MINUTES = 11 * 60;

function adjacentMonth(monthValue, offset) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function codeAt(shifts, monthValue, employeeId, day) {
  return shifts?.[monthValue]?.[employeeId]?.[dateKey(monthValue, day)] ?? "";
}

function issue(severity, category, message, detail = {}) {
  return { severity, category, message, ...detail };
}

function trailingWorkCodes(codes, typeMap) {
  const result = [];
  for (let index = codes.length - 1; index >= 0; index -= 1) {
    if (!typeMap.get(codes[index])?.isWork) break;
    result.unshift(codes[index]);
  }
  return result;
}

function leadingWorkCodes(codes, typeMap) {
  const result = [];
  for (const code of codes) {
    if (!typeMap.get(code)?.isWork) break;
    result.push(code);
  }
  return result;
}

function longestWorkStreak(codes, typeMap) {
  let current = 0;
  let longest = 0;
  for (const code of codes) {
    if (typeMap.get(code)?.isWork) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function employeeBoundaryIssues({ monthValue, employee, shifts, typeMap }) {
  const issues = [];
  const daysInMonth = getDaysInMonth(monthValue);
  const previousMonth = adjacentMonth(monthValue, -1);
  const nextMonth = adjacentMonth(monthValue, 1);
  const previousKnown = Boolean(shifts?.[previousMonth]?.[employee.id]);
  const nextKnown = Boolean(shifts?.[nextMonth]?.[employee.id]);
  const previousCodes = Array.from({ length: getDaysInMonth(previousMonth) }, (_, index) => codeAt(shifts, previousMonth, employee.id, index + 1));
  const currentCodes = Array.from({ length: daysInMonth }, (_, index) => codeAt(shifts, monthValue, employee.id, index + 1));
  const nextCodes = Array.from({ length: getDaysInMonth(nextMonth) }, (_, index) => codeAt(shifts, nextMonth, employee.id, index + 1));

  let previousWork = previousKnown ? typeMap.get(previousCodes.at(-1)) ?? null : null;
  if (!previousWork?.isWork) previousWork = null;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const current = typeMap.get(currentCodes[day - 1]) ?? null;
    if (!current?.isWork) {
      previousWork = null;
      continue;
    }
    if (previousWork && restGapMinutes(previousWork, current) < MINIMUM_REST_MINUTES) {
      issues.push(issue("error", "rest", `${employee.name}さんの${day}日前の休息が11時間未満です。`, { employeeId: employee.id, day }));
    }
    previousWork = current;
  }
  if (nextKnown && previousWork) {
    const next = typeMap.get(nextCodes[0]) ?? null;
    if (next?.isWork && restGapMinutes(previousWork, next) < MINIMUM_REST_MINUTES) {
      issues.push(issue("error", "rest", `${employee.name}さんは翌月1日までの休息が11時間未満です。`, { employeeId: employee.id, day: daysInMonth }));
    }
  }

  const combined = [
    ...(previousKnown ? trailingWorkCodes(previousCodes, typeMap) : []),
    ...currentCodes,
    ...(nextKnown ? leadingWorkCodes(nextCodes, typeMap) : [])
  ];
  const maxConsecutive = longestWorkStreak(combined, typeMap);
  const configuredMax = getRestPattern(employee.restPatternId).maxConsecutiveWorkDays || 6;
  if (maxConsecutive > configuredMax) {
    issues.push(issue("error", "consecutive", `${employee.name}さんの連続勤務が${maxConsecutive}日です（上限${configuredMax}日）。`, { employeeId: employee.id }));
  }
  if (!previousKnown || !nextKnown) {
    const missing = [!previousKnown ? "前月末" : "", !nextKnown ? "翌月初" : ""].filter(Boolean).join("・");
    issues.push(issue("info", "boundary", `${employee.name}さんは${missing}のシフトが未登録のため、月境界を完全には判定できません。`, { employeeId: employee.id }));
  }
  return issues;
}

export function validateMonthReadiness({
  monthValue,
  employees = [],
  shiftTypes = [],
  shifts = {},
  breaks = {},
  shiftLocks = {},
  requestedDaysOff = {},
  manualBreakLocks = {},
  coverageRequirements = []
}) {
  const issues = [];
  const daysInMonth = getDaysInMonth(monthValue);
  const typeMap = new Map(shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
  if (!employees.length) issues.push(issue("error", "master", "従業員が登録されていません。"));

  for (const employee of employees) {
    let overtimeMinutes = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateValue = dateKey(monthValue, day);
      const code = codeAt(shifts, monthValue, employee.id, day);
      const shiftType = typeMap.get(code) ?? null;
      if (!code) issues.push(issue("error", "blank", `${employee.name}さんの${day}日が空欄です。`, { employeeId: employee.id, day }));
      else if (!shiftType) issues.push(issue("error", "shift", `${employee.name}さんの${day}日に不明なシフト「${code}」があります。`, { employeeId: employee.id, day }));
      if (shiftType?.isWork) overtimeMinutes += overtimeMinutesForShift(shiftType);

      const marker = getRequestedDayOffInData(requestedDaysOff, monthValue, employee.id, dateValue);
      if (marker) {
        const valid = isShiftLockedInData(shiftLocks, monthValue, employee.id, dateValue)
          && marker.shiftCode === code
          && shiftType
          && !shiftType.isWork;
        if (!valid) issues.push(issue("error", "requested-off", `${employee.name}さんの${day}日の希望休データがセルと一致しません。`, { employeeId: employee.id, day }));
      }
      if (isManualBreakLockedInData(manualBreakLocks, dateValue, employee.id) && !(breaks?.[dateValue]?.[employee.id]?.length)) {
        issues.push(issue("warning", "break-lock", `${employee.name}さんの${day}日に休憩保護だけが残っています。`, { employeeId: employee.id, day }));
      }
    }
    const fixedOvertime = Math.max(0, Number(employee.fixedOvertimeMinutes) || 0);
    if (overtimeMinutes > fixedOvertime) {
      issues.push(issue("error", "overtime", `${employee.name}さんの残業見込が固定残業枠を${Math.round((overtimeMinutes - fixedOvertime) / 60 * 10) / 10}時間超えています。`, { employeeId: employee.id }));
    }
    issues.push(...employeeBoundaryIssues({ monthValue, employee, shifts, typeMap }));
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateValue = dateKey(monthValue, day);
    const overview = buildDailyOverview({ dateValue, employees, shiftTypes, shifts, breaks, coverageRequirements });
    for (const message of overview.requirementEvaluation.messages) {
      issues.push(issue("error", "coverage", `${day}日 ${message}`, { day }));
    }
    for (const row of overview.rows) {
      if (row.shiftType?.isWork && !row.validation.ok) {
        issues.push(issue("error", "break", `${row.employee.name}さん・${day}日: ${row.validation.issues.join(" / ")}`, { employeeId: row.employee.id, day }));
      }
    }
  }

  const blockingCount = issues.filter((item) => item.severity === "error").length;
  return {
    ready: blockingCount === 0,
    blockingCount,
    warningCount: issues.filter((item) => item.severity === "warning").length,
    infoCount: issues.filter((item) => item.severity === "info").length,
    issues
  };
}

export function minutesBetweenShiftDays(previousShift, nextShift) {
  if (!previousShift?.isWork || !nextShift?.isWork) return null;
  const previousEnd = timeToMinutes(previousShift.end);
  const nextStart = timeToMinutes(nextShift.start);
  return previousEnd === null || nextStart === null ? null : (24 * 60 - previousEnd) + nextStart;
}
