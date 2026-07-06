import { dayFromDate, getDayInfo, timeToMinutes } from "./date-time.js";
import { validateBreaks } from "./break-rules.js";
import { EMPLOYMENT_TYPES, normalizeEmploymentType } from "./employment-types.js";
import {
  activeRequirementsForWeekday,
  evaluateCoverage,
  requirementBounds
} from "./coverage-requirements.js";
import { buildShiftTypeMap, getShiftCodeFromData } from "./month-overview.js";

export const TIMELINE_SLOT_MINUTES = 15;

// 必要人数バンドは、勤務がない時間帯でも不足を示せるよう表示範囲へ含める。
function timelineRange(assignments, requirementBoundary = { start: null, end: null }) {
  const starts = [];
  const ends = [];
  for (const assignment of assignments) {
    if (!assignment.shiftType?.isWork) continue;
    if (assignment.shiftStart !== null) starts.push(assignment.shiftStart);
    if (assignment.shiftEnd !== null) ends.push(assignment.shiftEnd);
  }
  if (requirementBoundary.start !== null) starts.push(requirementBoundary.start);
  if (requirementBoundary.end !== null) ends.push(requirementBoundary.end);
  const start = starts.length ? Math.max(0, Math.floor(Math.min(...starts) / 60) * 60) : 8 * 60;
  const end = ends.length ? Math.min(24 * 60, Math.ceil(Math.max(...ends) / 60) * 60) : 22 * 60;
  return { start, end: Math.max(start + 60, end) };
}

function buildSlots(start, end) {
  const slots = [];
  for (let minute = start; minute < end; minute += TIMELINE_SLOT_MINUTES) slots.push(minute);
  return slots;
}

function normalizedBreaks(breaks = []) {
  return breaks.map((breakItem, index) => ({
    ...breakItem,
    index,
    startMinute: timeToMinutes(breakItem?.start),
    endMinute: timeToMinutes(breakItem?.end)
  })).filter((breakItem) => (
    breakItem.startMinute !== null
    && breakItem.endMinute !== null
    && breakItem.endMinute > breakItem.startMinute
  ));
}

function slotCell(assignment, slotStart) {
  if (!assignment.shiftType?.isWork) return { kind: "off", title: "" };
  if (slotStart < assignment.shiftStart || slotStart >= assignment.shiftEnd) {
    return { kind: "off", title: "" };
  }

  const breakItem = assignment.breaks.find((item) => (
    slotStart >= item.startMinute && slotStart < item.endMinute
  ));
  if (breakItem) {
    return {
      kind: "break",
      breakIndex: breakItem.index,
      breakStart: breakItem.startMinute,
      breakEnd: breakItem.endMinute,
      breakType: breakItem.type,
      title: `${breakItem.label} ${breakItem.start}〜${breakItem.end}`
    };
  }

  return {
    kind: "work",
    shiftCode: assignment.shiftCode,
    title: `${assignment.shiftType.name} ${assignment.shiftType.start}〜${assignment.shiftType.end}`
  };
}

export function buildDailyOverview({
  dateValue,
  employees = [],
  shiftTypes = [],
  shifts = {},
  breaks = {},
  coverageRequirements = []
}) {
  const monthValue = dateValue.slice(0, 7);
  const day = dayFromDate(dateValue);
  const weekday = getDayInfo(monthValue, day).weekday;
  const activeRequirements = activeRequirementsForWeekday(coverageRequirements, weekday);
  const shiftTypesByCode = buildShiftTypeMap(shiftTypes);

  const assignments = employees.map((employee) => {
    const shiftCode = getShiftCodeFromData(shifts, monthValue, employee.id, day);
    const shiftType = shiftTypesByCode.get(shiftCode) ?? null;
    const employeeBreaks = breaks?.[dateValue]?.[employee.id] ?? [];
    return {
      employee,
      shiftCode,
      shiftType,
      shiftStart: timeToMinutes(shiftType?.start),
      shiftEnd: timeToMinutes(shiftType?.end),
      breaks: normalizedBreaks(employeeBreaks),
      rawBreaks: employeeBreaks,
      validation: validateBreaks(shiftType, employeeBreaks)
    };
  });

  const range = timelineRange(assignments, requirementBounds(activeRequirements));
  const slots = buildSlots(range.start, range.end);
  const coverage = slots.map(() => 0);
  // 雇用区分ごとに必要人数が異なるため、休憩を除いた実配置人数を区分別にも集計する。
  const coverageByType = Object.fromEntries(
    EMPLOYMENT_TYPES.map((type) => [type.code, slots.map(() => 0)])
  );
  const rows = assignments.map((assignment) => {
    const employmentType = normalizeEmploymentType(assignment.employee.employmentType);
    const cells = slots.map((slotStart, index) => {
      const cell = slotCell(assignment, slotStart);
      if (cell.kind === "work") {
        coverage[index] += 1;
        coverageByType[employmentType][index] += 1;
      }
      return cell;
    });
    return { ...assignment, employmentType, cells };
  });

  const requirementEvaluation = evaluateCoverage({
    activeRequirements,
    slots,
    coverage,
    coverageByType
  });

  return {
    dateValue,
    monthValue,
    day,
    weekday,
    range,
    slots,
    coverage,
    coverageByType,
    requirementEvaluation,
    rows
  };
}
