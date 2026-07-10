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
  if (slotStart < assignment.shiftStart || slotStart >= assignment.shiftEnd) return { kind: "off", title: "" };
  const breakItem = assignment.breaks.find((item) => slotStart >= item.startMinute && slotStart < item.endMinute);
  if (breakItem) {
    return {
      kind: "break",
      breakIndex: breakItem.index,
      breakStart: breakItem.startMinute,
      breakEnd: breakItem.endMinute,
      isBreakStart: slotStart === breakItem.startMinute,
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

function coverageMap(names, slotCount) {
  return Object.fromEntries([...new Set(names.filter(Boolean))].map((name) => [name, Array(slotCount).fill(0)]));
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
  const coverage = Array(slots.length).fill(0);
  const coverageByType = Object.fromEntries(
    EMPLOYMENT_TYPES.map((type) => [type.code, Array(slots.length).fill(0)])
  );
  const coverageByDepartment = coverageMap(
    activeRequirements.map((requirement) => requirement.requiredDepartment),
    slots.length
  );
  const coverageByQualification = coverageMap(
    activeRequirements.map((requirement) => requirement.requiredQualification),
    slots.length
  );

  const rows = assignments.map((assignment) => {
    const employmentType = normalizeEmploymentType(assignment.employee.employmentType);
    const qualifications = Array.isArray(assignment.employee.qualifications) ? assignment.employee.qualifications : [];
    const cells = slots.map((slotStart, index) => {
      const cell = slotCell(assignment, slotStart);
      if (cell.kind === "work") {
        coverage[index] += 1;
        coverageByType[employmentType][index] += 1;
        const department = assignment.employee.department;
        if (coverageByDepartment[department]) coverageByDepartment[department][index] += 1;
        for (const qualification of qualifications) {
          if (coverageByQualification[qualification]) coverageByQualification[qualification][index] += 1;
        }
      }
      return cell;
    });
    return { ...assignment, employmentType, qualifications, cells };
  });

  const requirementEvaluation = evaluateCoverage({
    activeRequirements,
    slots,
    coverage,
    coverageByType,
    coverageByDepartment,
    coverageByQualification
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
    coverageByDepartment,
    coverageByQualification,
    requirementEvaluation,
    rows
  };
}
