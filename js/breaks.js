import {
  state,
  dayFromDate,
  shiftDurationMinutes,
  timeToMinutes,
  minutesToTime,
  setBreaksForDate,
  scheduleSave
} from "./model.js";
import { plannedBreakTemplates, breaksFitShiftWindow } from "./break-rules.js";
import { scheduleBreaks } from "./break-scheduler.js";
import { isManualBreakLockedInData, setManualBreakLockInData } from "./manual-break-locks.js";
import { buildShiftTypeMap, getShiftCodeFromData } from "./month-overview.js";
import { findBrokenBreakAssignments } from "./break-integrity.js";

function workingAssignments(dateValue) {
  const monthValue = dateValue.slice(0, 7);
  const day = dayFromDate(dateValue);
  const shiftTypesByCode = buildShiftTypeMap(state.shiftTypes);
  return state.employees
    .map((employee) => {
      const shiftCode = getShiftCodeFromData(state.shifts, monthValue, employee.id, day);
      const shiftType = shiftTypesByCode.get(shiftCode) ?? null;
      return { employee, shiftCode, shiftType };
    })
    .filter((assignment) => assignment.shiftType?.isWork)
    .sort((a, b) => {
      const startDifference = timeToMinutes(a.shiftType.start) - timeToMinutes(b.shiftType.start);
      return startDifference || a.employee.order - b.employee.order || a.employee.name.localeCompare(b.employee.name, "ja");
    });
}

function toMinuteIntervals(breaks) {
  return (breaks ?? [])
    .map((breakItem) => ({
      startMinute: timeToMinutes(breakItem.start),
      endMinute: timeToMinutes(breakItem.end)
    }))
    .filter((interval) => interval.startMinute !== null && interval.endMinute !== null && interval.endMinute > interval.startMinute);
}

export function generateBreaksForDate(dateValue, employeeIds = null, options = {}) {
  const assignments = workingAssignments(dateValue);
  const workingIds = new Set(assignments.map(({ employee }) => employee.id));
  const requestedTargets = employeeIds ? new Set(employeeIds) : new Set(workingIds);
  const result = structuredClone(state.breaks[dateValue] ?? {});
  const preserveManual = options.preserveManual !== false;
  const movableIds = new Set();

  const shiftTypeById = new Map(assignments.map(({ employee, shiftType }) => [employee.id, shiftType]));

  for (const employeeId of requestedTargets) {
    if (!workingIds.has(employeeId)) {
      delete result[employeeId];
      continue;
    }
    const hasExisting = Array.isArray(result[employeeId]) && result[employeeId].length > 0;
    // 保護された手動休憩でも、シフト変更・マスター更新で勤務枠に収まらなくなった場合は
    // 保護を解除して自動再配置する。時間外の休憩を温存しないための整合性ルール。
    const fitsWindow = hasExisting && breaksFitShiftWindow(shiftTypeById.get(employeeId), result[employeeId]);
    const protectedBreak = preserveManual
      && fitsWindow
      && isManualBreakLockedInData(state.manualBreakLocks, dateValue, employeeId);
    if (!protectedBreak) {
      if (hasExisting && !fitsWindow) {
        state.manualBreakLocks ??= {};
        setManualBreakLockInData(state.manualBreakLocks, dateValue, employeeId, false);
      }
      movableIds.add(employeeId);
      delete result[employeeId];
    }
  }

  const schedulerInput = assignments.map(({ employee, shiftType }) => {
    const movable = movableIds.has(employee.id);
    return {
      id: employee.id,
      shiftStart: timeToMinutes(shiftType.start),
      shiftEnd: timeToMinutes(shiftType.end),
      movable,
      templates: movable ? plannedBreakTemplates(shiftDurationMinutes(shiftType)) : [],
      existingBreaks: movable ? [] : toMinuteIntervals(result[employee.id])
    };
  });

  for (const [employeeId, placements] of scheduleBreaks(schedulerInput)) {
    result[employeeId] = placements.map((placement) => ({
      type: placement.type,
      label: placement.label,
      start: minutesToTime(placement.startMinute),
      end: minutesToTime(placement.endMinute)
    }));
  }

  setBreaksForDate(dateValue, result, { save: options.save !== false });
  return result;
}

export function ensureBreaksForDate(dateValue) {
  return state.breaks[dateValue] ?? {};
}

// 全日付を走査し、勤務枠に収まらない休憩・勤務でない日の残留休憩を再配置する。
// マスター再取込でシフト時刻が変わった直後に呼び、時間外の休憩を残さない。
// 戻り値は修復した日付数。
export function repairBrokenBreaks({ save = true } = {}) {
  const broken = findBrokenBreakAssignments({
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    breaks: state.breaks
  });
  for (const { dateValue, employeeIds } of broken) {
    state.manualBreakLocks ??= {};
    for (const employeeId of employeeIds) {
      setManualBreakLockInData(state.manualBreakLocks, dateValue, employeeId, false);
    }
    generateBreaksForDate(dateValue, employeeIds, { save: false, preserveManual: false });
  }
  if (broken.length && save) scheduleSave();
  return broken.length;
}

export function availableWorkersAt(dateValue, slotStart) {
  const monthValue = dateValue.slice(0, 7);
  const day = dayFromDate(dateValue);
  const shiftTypesByCode = buildShiftTypeMap(state.shiftTypes);
  let count = 0;
  for (const employee of state.employees) {
    const shiftCode = getShiftCodeFromData(state.shifts, monthValue, employee.id, day);
    const shiftType = shiftTypesByCode.get(shiftCode) ?? null;
    if (!shiftType?.isWork) continue;
    const start = timeToMinutes(shiftType.start);
    const end = timeToMinutes(shiftType.end);
    if (slotStart < start || slotStart >= end) continue;
    const isOnBreak = (state.breaks[dateValue]?.[employee.id] ?? []).some((breakItem) => {
      const breakStart = timeToMinutes(breakItem.start);
      const breakEnd = timeToMinutes(breakItem.end);
      return slotStart >= breakStart && slotStart < breakEnd;
    });
    if (!isOnBreak) count += 1;
  }
  return count;
}
