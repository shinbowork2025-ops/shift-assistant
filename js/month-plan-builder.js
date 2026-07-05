import { buildDaysOffPlan } from "./auto-days-off.js";
import { buildWorkShiftPlan } from "./auto-work-shifts.js";
import { dateKey, getDaysInMonth } from "./date-time.js";
import { isDayOffRequestedInData } from "./day-off-requests.js";
import { PUBLIC_HOLIDAY_CODE } from "./shift-catalog-migration.js";
import { isShiftLockedInData } from "./shift-locks.js";
import { availableWorkShiftCodes } from "./work-shift-preferences.js";

function valueAt(shifts, monthValue, employeeId, day) {
  return shifts?.[monthValue]?.[employeeId]?.[dateKey(monthValue, day)] ?? "";
}

function ensureEmployee(container, employeeId) {
  container[employeeId] ??= {};
  return container[employeeId];
}

function setTempShift(shifts, monthValue, employeeId, day, code) {
  const key = dateKey(monthValue, day);
  if (code) {
    shifts[monthValue] ??= {};
    shifts[monthValue][employeeId] ??= {};
    shifts[monthValue][employeeId][key] = code;
  } else {
    delete shifts[monthValue]?.[employeeId]?.[key];
  }
}

function lockTempCell(locks, monthValue, employeeId, day) {
  const key = dateKey(monthValue, day);
  locks[monthValue] ??= {};
  locks[monthValue][employeeId] ??= {};
  locks[monthValue][employeeId][key] = true;
}

function applyChanges(assignments, shifts, monthValue, changes) {
  for (const change of changes) {
    ensureEmployee(assignments, change.employeeId)[change.day] = change.after;
    setTempShift(shifts, monthValue, change.employeeId, change.day, change.after);
  }
}

export function buildInitialMonthPlan(options) {
  const monthValue = String(options?.monthValue ?? "");
  const daysInMonth = getDaysInMonth(monthValue);
  const employees = Array.isArray(options?.employees) ? structuredClone(options.employees) : [];
  const shiftTypes = Array.isArray(options?.shiftTypes) ? structuredClone(options.shiftTypes) : [];
  const selectedEmployeeIds = new Set(
    Array.isArray(options?.selectedEmployeeIds) && options.selectedEmployeeIds.length
      ? options.selectedEmployeeIds
      : employees.map((employee) => employee.id)
  );
  const selectedEmployees = employees.filter((employee) => selectedEmployeeIds.has(employee.id));
  const typeMap = new Map(shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
  const publicHolidayCode = typeMap.has(options?.publicHolidayCode)
    ? options.publicHolidayCode
    : typeMap.has(PUBLIC_HOLIDAY_CODE)
      ? PUBLIC_HOLIDAY_CODE
      : shiftTypes.find((shiftType) => !shiftType.isWork && shiftType.name === "公休")?.code;
  if (!publicHolidayCode) throw new Error("公休として使うシフト区分が見つかりません。");

  const selectedWorkShiftCodes = Array.isArray(options?.selectedWorkShiftCodes) && options.selectedWorkShiftCodes.length
    ? options.selectedWorkShiftCodes
    : shiftTypes.filter((shiftType) => shiftType.isWork).map((shiftType) => shiftType.code);
  const assignments = {};
  const fixedValues = {};
  const requestedOff = {};
  const tempShifts = {};
  const tempLocks = {};
  const conflicts = [];

  for (const employee of employees) {
    const employeeAssignments = ensureEmployee(assignments, employee.id);
    const employeeFixed = ensureEmployee(fixedValues, employee.id);
    const employeeRequests = ensureEmployee(requestedOff, employee.id);
    const selected = selectedEmployeeIds.has(employee.id);

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateValue = dateKey(monthValue, day);
      const existing = valueAt(options?.shifts, monthValue, employee.id, day);
      const locked = isShiftLockedInData(options?.shiftLocks, monthValue, employee.id, dateValue);
      const requested = selected && isDayOffRequestedInData(options?.dayOffRequests, monthValue, employee.id, dateValue);
      employeeAssignments[day] = existing;
      if (existing) setTempShift(tempShifts, monthValue, employee.id, day, existing);

      if (requested) {
        employeeRequests[day] = true;
        if (existing && existing !== publicHolidayCode) {
          conflicts.push(`${employee.name}・${day}日は希望休と入力済みシフト「${existing}」が競合しています。`);
        } else if (!existing && locked) {
          // ロックされた空きセルは適用時（respectLock）に公休へ変更できないため、
          // プレビューだけ公休になり適用では空欄のまま残る不整合を防ぐ。競合として扱う。
          conflicts.push(`${employee.name}・${day}日は希望休とロックされた空きセルが競合しています。`);
        }
        employeeAssignments[day] = publicHolidayCode;
        setTempShift(tempShifts, monthValue, employee.id, day, publicHolidayCode);
        employeeFixed[day] = publicHolidayCode;
        lockTempCell(tempLocks, monthValue, employee.id, day);
      } else if (!selected || existing || locked) {
        employeeFixed[day] = existing;
        lockTempCell(tempLocks, monthValue, employee.id, day);
      }
    }
  }
  if (conflicts.length) throw new Error(conflicts.join("\n"));

  const daysOffPlan = buildDaysOffPlan({
    monthValue,
    employees: selectedEmployees,
    shiftTypes,
    shifts: tempShifts,
    shiftLocks: tempLocks,
    offShiftCode: publicHolidayCode,
    mode: "empty-only"
  });
  applyChanges(assignments, tempShifts, monthValue, daysOffPlan.changes);

  const workPlan = buildWorkShiftPlan({
    monthValue,
    employees: selectedEmployees,
    shiftTypes,
    shifts: tempShifts,
    shiftLocks: tempLocks,
    selectedShiftCodes: selectedWorkShiftCodes,
    mode: "empty-only"
  });
  applyChanges(assignments, tempShifts, monthValue, workPlan.changes);

  const allowedCodes = {};
  for (const employee of employees) {
    const selectedWorkTypes = shiftTypes.filter((shiftType) => selectedWorkShiftCodes.includes(shiftType.code));
    const employeeWorkCodes = availableWorkShiftCodes(employee, selectedWorkTypes);
    allowedCodes[employee.id] = selectedEmployeeIds.has(employee.id)
      ? [publicHolidayCode, ...employeeWorkCodes]
      : [];
  }

  const unassigned = [];
  for (const employee of selectedEmployees) {
    for (let day = 1; day <= daysInMonth; day += 1) {
      if (fixedValues[employee.id]?.[day] !== undefined) continue;
      if (!assignments[employee.id]?.[day]) unassigned.push(`${employee.name}・${day}日`);
    }
  }
  if (unassigned.length) {
    throw new Error(`勤務シフトを割り当てられないセルがあります: ${unassigned.slice(0, 8).join("、")}${unassigned.length > 8 ? "…" : ""}`);
  }

  return {
    monthValue,
    daysInMonth,
    employees,
    shiftTypes,
    selectedEmployeeIds: [...selectedEmployeeIds],
    selectedWorkShiftCodes,
    publicHolidayCode,
    assignments,
    fixedValues,
    requestedOff,
    allowedCodes,
    initialSummary: {
      daysOff: daysOffPlan.summary,
      workShifts: workPlan.summary,
      warnings: [...daysOffPlan.warnings, ...workPlan.warnings]
    }
  };
}

export function monthPlanChanges(plan, originalShifts) {
  const changes = [];
  for (const employeeId of plan.selectedEmployeeIds) {
    const employee = plan.employees.find((item) => item.id === employeeId);
    for (let day = 1; day <= plan.daysInMonth; day += 1) {
      const before = valueAt(originalShifts, plan.monthValue, employeeId, day);
      const after = plan.assignments?.[employeeId]?.[day] ?? "";
      if (before === after) continue;
      changes.push({ employeeId, employeeName: employee?.name ?? employeeId, day, before, after });
    }
  }
  return changes;
}
