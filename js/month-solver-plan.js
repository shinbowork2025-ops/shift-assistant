import { buildDaysOffPlan, findDefaultDaysOffShiftCode } from "./auto-days-off.js";
import { buildWorkShiftPlan } from "./auto-work-shifts.js";
import { dateKey, getDaysInMonth } from "./date-time.js";
import { getRestPattern, normalizeTargetDaysOff } from "./rest-patterns.js";
import { isShiftLockedInData } from "./shift-locks.js";
import { availableWorkShiftCodes } from "./work-shift-preferences.js";
import { validWorkShiftTypes } from "./work-shift-planner-core.js";

function codeAt(shifts, monthValue, employeeId, day) {
  return shifts?.[monthValue]?.[employeeId]?.[dateKey(monthValue, day)] ?? "";
}

function setCode(shifts, monthValue, employeeId, day, code) {
  const dateValue = dateKey(monthValue, day);
  if (code) {
    shifts[monthValue] ??= {};
    shifts[monthValue][employeeId] ??= {};
    shifts[monthValue][employeeId][dateValue] = code;
  } else {
    delete shifts[monthValue]?.[employeeId]?.[dateValue];
    if (shifts[monthValue]?.[employeeId] && Object.keys(shifts[monthValue][employeeId]).length === 0) {
      delete shifts[monthValue][employeeId];
    }
    if (shifts[monthValue] && Object.keys(shifts[monthValue]).length === 0) delete shifts[monthValue];
  }
}

function lockCell(locks, monthValue, employeeId, day) {
  const dateValue = dateKey(monthValue, day);
  locks[monthValue] ??= {};
  locks[monthValue][employeeId] ??= {};
  locks[monthValue][employeeId][dateValue] = true;
}

function applyPlannerChanges(shifts, monthValue, changes) {
  for (const change of changes) setCode(shifts, monthValue, change.employeeId, change.day, change.after);
}

function originalDominantCode(shifts, monthValue, employeeId, daysInMonth, typeMap) {
  const counts = new Map();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const code = codeAt(shifts, monthValue, employeeId, day);
    if (typeMap.get(code)?.isWork) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))[0]?.[0] ?? "";
}

function targetDaysOff(employee, daysInMonth, originalShifts, monthValue, typeMap) {
  const explicit = normalizeTargetDaysOff(employee.targetDaysOff);
  if (explicit > 0) return explicit;
  const pattern = getRestPattern(employee.restPatternId);
  if (pattern.cycle.length) {
    const offItems = pattern.cycle.filter((item) => item === "off").length;
    return Math.round(daysInMonth * offItems / pattern.cycle.length);
  }
  let existing = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const code = codeAt(originalShifts, monthValue, employee.id, day);
    if (code && typeMap.get(code) && !typeMap.get(code).isWork) existing += 1;
  }
  return existing;
}

function maxConsecutive(employee) {
  const pattern = getRestPattern(employee.restPatternId);
  return pattern.maxConsecutiveWorkDays > 0 ? pattern.maxConsecutiveWorkDays : 6;
}

export function buildMonthSolverPlan(options = {}) {
  const monthValue = String(options.monthValue ?? "");
  const employees = Array.isArray(options.employees) ? structuredClone(options.employees) : [];
  const shiftTypes = Array.isArray(options.shiftTypes) ? structuredClone(options.shiftTypes) : [];
  const originalShifts = options.shifts && typeof options.shifts === "object" ? structuredClone(options.shifts) : {};
  const originalLocks = options.shiftLocks && typeof options.shiftLocks === "object" ? structuredClone(options.shiftLocks) : {};
  const daysInMonth = getDaysInMonth(monthValue);
  const typeMap = new Map(shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
  const publicHolidayCode = options.publicHolidayCode || findDefaultDaysOffShiftCode(shiftTypes);
  if (!publicHolidayCode || typeMap.get(publicHolidayCode)?.isWork !== false) {
    throw new Error("月間ソルバーで使う公休区分が見つかりません。");
  }

  const selectedEmployeeIds = new Set(
    Array.isArray(options.selectedEmployeeIds) && options.selectedEmployeeIds.length
      ? options.selectedEmployeeIds
      : employees.map((employee) => employee.id)
  );
  const workTypes = validWorkShiftTypes(shiftTypes);
  const selectedShiftCodes = new Set(
    Array.isArray(options.selectedShiftCodes) && options.selectedShiftCodes.length
      ? options.selectedShiftCodes
      : workTypes.map((shiftType) => shiftType.code)
  );
  const selectedWorkTypes = workTypes.filter((shiftType) => selectedShiftCodes.has(shiftType.code));
  if (!selectedWorkTypes.length) throw new Error("月間ソルバーで使う勤務シフトを1つ以上選択してください。");

  const tempShifts = structuredClone(originalShifts);
  const solverLocks = structuredClone(originalLocks);
  const fixedValues = {};

  for (const employee of employees) {
    fixedValues[employee.id] = {};
    const selected = selectedEmployeeIds.has(employee.id);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const code = codeAt(originalShifts, monthValue, employee.id, day);
      const shiftType = typeMap.get(code) ?? null;
      const locked = isShiftLockedInData(originalLocks, monthValue, employee.id, dateKey(monthValue, day));
      const protectedLeave = Boolean(code && shiftType && !shiftType.isWork && code !== publicHolidayCode);
      if (!selected || locked || protectedLeave) {
        fixedValues[employee.id][day] = code;
        lockCell(solverLocks, monthValue, employee.id, day);
      }
    }
  }

  const selectedEmployees = employees.filter((employee) => selectedEmployeeIds.has(employee.id));
  const daysOffPlan = buildDaysOffPlan({
    monthValue,
    employees: selectedEmployees,
    shiftTypes,
    shifts: tempShifts,
    shiftLocks: solverLocks,
    offShiftCode: publicHolidayCode,
    mode: "replace-unlocked"
  });
  applyPlannerChanges(tempShifts, monthValue, daysOffPlan.changes);

  const workPlan = buildWorkShiftPlan({
    monthValue,
    employees: selectedEmployees,
    shiftTypes,
    shifts: tempShifts,
    shiftLocks: solverLocks,
    coverageRequirements: options.coverageRequirements,
    selectedShiftCodes: [...selectedShiftCodes],
    mode: "replace-unlocked-work"
  });
  applyPlannerChanges(tempShifts, monthValue, workPlan.changes);

  const assignments = {};
  const originalAssignments = {};
  const allowedCodes = {};
  const targetDaysOffByEmployee = {};
  const maxConsecutiveByEmployee = {};
  const dominantCodeByEmployee = {};
  const mutableCells = [];

  for (const employee of employees) {
    assignments[employee.id] = {};
    originalAssignments[employee.id] = {};
    const allowedWork = availableWorkShiftCodes(employee, selectedWorkTypes);
    allowedCodes[employee.id] = selectedEmployeeIds.has(employee.id)
      ? [publicHolidayCode, ...allowedWork]
      : [];
    targetDaysOffByEmployee[employee.id] = targetDaysOff(
      employee,
      daysInMonth,
      originalShifts,
      monthValue,
      typeMap
    );
    maxConsecutiveByEmployee[employee.id] = maxConsecutive(employee);
    dominantCodeByEmployee[employee.id] = originalDominantCode(
      originalShifts,
      monthValue,
      employee.id,
      daysInMonth,
      typeMap
    );

    for (let day = 1; day <= daysInMonth; day += 1) {
      const original = codeAt(originalShifts, monthValue, employee.id, day);
      const planned = codeAt(tempShifts, monthValue, employee.id, day);
      originalAssignments[employee.id][day] = original;
      assignments[employee.id][day] = fixedValues[employee.id][day] !== undefined
        ? fixedValues[employee.id][day]
        : planned;
      if (fixedValues[employee.id][day] === undefined) mutableCells.push({ employeeId: employee.id, day });
    }
  }

  const unassigned = mutableCells.filter(({ employeeId, day }) => !assignments[employeeId][day]);
  if (unassigned.length) {
    const examples = unassigned.slice(0, 8).map(({ employeeId, day }) => {
      const employee = employees.find((item) => item.id === employeeId);
      return `${employee?.name ?? employeeId}・${day}日`;
    });
    throw new Error(`勤務を割り当てられないセルがあります: ${examples.join("、")}${unassigned.length > 8 ? "…" : ""}`);
  }

  return {
    monthValue,
    daysInMonth,
    employees,
    shiftTypes,
    coverageRequirements: structuredClone(options.coverageRequirements ?? []),
    selectedEmployeeIds: [...selectedEmployeeIds],
    selectedShiftCodes: [...selectedShiftCodes],
    publicHolidayCode,
    assignments,
    originalAssignments,
    fixedValues,
    allowedCodes,
    targetDaysOffByEmployee,
    maxConsecutiveByEmployee,
    dominantCodeByEmployee,
    mutableCells,
    initialWarnings: [...daysOffPlan.warnings, ...workPlan.warnings]
  };
}

export function monthSolverChanges(plan, currentShifts) {
  const changes = [];
  const selected = new Set(plan.selectedEmployeeIds);
  for (const employee of plan.employees) {
    if (!selected.has(employee.id)) continue;
    for (let day = 1; day <= plan.daysInMonth; day += 1) {
      const before = codeAt(currentShifts, plan.monthValue, employee.id, day);
      const after = plan.assignments[employee.id]?.[day] ?? "";
      if (before === after) continue;
      changes.push({ employeeId: employee.id, employeeName: employee.name, day, before, after });
    }
  }
  return changes;
}
