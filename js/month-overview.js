import { buildMonthDays, dateKey } from "./date-time.js";
import {
  nonNegativeMinutes,
  paidMinutesForShift,
  overtimeMinutesForShift
} from "./shift-metrics.js";

export function buildShiftTypeMap(shiftTypes = []) {
  return new Map(shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
}

export function getShiftCodeFromData(shifts, monthValue, employeeId, day) {
  return shifts?.[monthValue]?.[employeeId]?.[dateKey(monthValue, day)] ?? "";
}

export function buildMonthOverview({ monthValue, employees = [], shiftTypes = [], shifts = {} }) {
  const days = buildMonthDays(monthValue);
  const shiftTypesByCode = buildShiftTypeMap(shiftTypes);
  const daySummaries = days.map((day) => ({
    ...day,
    workers: 0,
    paidMinutes: 0,
    overtimeMinutes: 0
  }));

  const employeeRows = employees.map((employee) => {
    let workDays = 0;
    let paidMinutes = 0;
    let overtimeMinutes = 0;

    const cells = days.map((dayInfo, index) => {
      const code = getShiftCodeFromData(shifts, monthValue, employee.id, dayInfo.day);
      const shiftType = shiftTypesByCode.get(code) ?? null;
      const shiftPaidMinutes = paidMinutesForShift(shiftType);
      const shiftOvertimeMinutes = overtimeMinutesForShift(shiftType);

      if (shiftPaidMinutes > 0) workDays += 1;
      paidMinutes += shiftPaidMinutes;
      overtimeMinutes += shiftOvertimeMinutes;
      if (shiftType?.isWork) daySummaries[index].workers += 1;
      daySummaries[index].paidMinutes += shiftPaidMinutes;
      daySummaries[index].overtimeMinutes += shiftOvertimeMinutes;

      return { code, shiftType };
    });

    const fixedOvertimeMinutes = nonNegativeMinutes(employee.fixedOvertimeMinutes);
    return {
      employee,
      cells,
      summary: {
        workDays,
        paidMinutes,
        hours: paidMinutes / 60,
        overtimeMinutes,
        overtimeHours: overtimeMinutes / 60,
        fixedOvertimeMinutes,
        fixedOvertimeHours: fixedOvertimeMinutes / 60,
        overtimeRemainingMinutes: fixedOvertimeMinutes - overtimeMinutes,
        overtimeRemainingHours: (fixedOvertimeMinutes - overtimeMinutes) / 60,
        overtimeExceededMinutes: Math.max(0, overtimeMinutes - fixedOvertimeMinutes),
        overtimeExceededHours: Math.max(0, overtimeMinutes - fixedOvertimeMinutes) / 60
      }
    };
  });

  return {
    monthValue,
    days,
    shiftTypesByCode,
    employeeRows,
    daySummaries
  };
}
