// 配置済み休憩と現在のシフト割当の整合性を検査する純粋モジュール。
// マスター再取込でシフト時刻が変わった場合や、勤務でない日に休憩だけが
// 残った場合を検出し、再配置が必要な日付と従業員を列挙する。
import { dayFromDate } from "./date-time.js";
import { buildShiftTypeMap, getShiftCodeFromData } from "./month-overview.js";
import { breaksFitShiftWindow } from "./break-rules.js";

export function findBrokenBreakAssignments({ shiftTypes = [], shifts = {}, breaks = {} }) {
  const shiftTypesByCode = buildShiftTypeMap(shiftTypes);
  const broken = [];

  for (const [dateValue, byEmployee] of Object.entries(breaks ?? {})) {
    const monthValue = dateValue.slice(0, 7);
    const day = dayFromDate(dateValue);
    const employeeIds = [];

    for (const [employeeId, items] of Object.entries(byEmployee ?? {})) {
      if (!Array.isArray(items) || items.length === 0) continue;
      const code = getShiftCodeFromData(shifts, monthValue, employeeId, day);
      const shiftType = shiftTypesByCode.get(code) ?? null;
      if (!shiftType?.isWork || !breaksFitShiftWindow(shiftType, items)) {
        employeeIds.push(employeeId);
      }
    }

    if (employeeIds.length) broken.push({ dateValue, employeeIds });
  }

  return broken;
}
