import { buildMonthDays, isValidTime } from "./date-time.js";
import { validateBreaks } from "./break-rules.js";
import { buildMonthOverview, buildShiftTypeMap, getShiftCodeFromData } from "./month-overview.js";
import {
  breakMinutesWithinShift,
  formatDurationMinutes,
  overtimeMinutesForShift,
  paidMinutesForShift,
  shiftDurationMinutes
} from "./shift-metrics.js";

export { formatDurationMinutes as formatDuration };

function sortedEmployees(workspace) {
  return [...(workspace.employees ?? [])].sort((a, b) =>
    (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name), "ja")
  );
}

export function buildMonthlyPrintData(workspace) {
  const monthValue = workspace.selectedMonth ?? workspace.targetMonth;
  const overview = buildMonthOverview({
    monthValue,
    employees: sortedEmployees(workspace),
    shiftTypes: workspace.shiftTypes ?? [],
    shifts: workspace.shifts ?? {}
  });
  const rows = overview.employeeRows.map(({ employee, cells, summary }) => ({
    employeeId: employee.id,
    name: employee.name,
    code: employee.code ?? "",
    department: employee.department ?? "",
    cells: cells.map(({ code, shiftType }) => ({
      code,
      label: shiftType ? String(shiftType.shortLabel || shiftType.name).slice(0, 4) : "",
      name: shiftType?.name ?? ""
    })),
    workDays: summary.workDays,
    paidMinutes: summary.paidMinutes,
    overtimeMinutes: summary.overtimeMinutes
  }));

  const legend = (workspace.shiftTypes ?? []).map((shiftType) => ({
    label: String(shiftType.shortLabel || shiftType.name).slice(0, 4),
    name: shiftType.name,
    time: shiftType.isWork ? `${shiftType.start}–${shiftType.end}` : "",
    overtimeMinutes: overtimeMinutesForShift(shiftType)
  }));

  return { monthValue, days: overview.days, rows, legend };
}

function breakText(breaks, shiftType) {
  if (!breaks.length) {
    return shiftDurationMinutes(shiftType) > 240 ? "未配置" : "なし";
  }
  return breaks
    .filter((item) => isValidTime(item?.start) && isValidTime(item?.end))
    .map((item) => `${item.start}–${item.end}`)
    .join(" / ") || "未設定";
}

export function buildTransferPrintData(workspace) {
  const monthValue = workspace.selectedMonth ?? workspace.targetMonth;
  const shiftTypesByCode = buildShiftTypeMap(workspace.shiftTypes ?? []);
  const employees = sortedEmployees(workspace);
  const groups = [];

  for (const dayInfo of buildMonthDays(monthValue)) {
    const rows = [];
    for (const employee of employees) {
      const shiftCode = getShiftCodeFromData(workspace.shifts, monthValue, employee.id, dayInfo.day);
      if (!shiftCode) continue;
      const shiftType = shiftTypesByCode.get(shiftCode) ?? null;
      if (!shiftType) continue;
      const breaks = workspace.breaks?.[dayInfo.dateValue]?.[employee.id] ?? [];
      const validation = validateBreaks(shiftType, breaks);
      const actualBreakMinutes = breakMinutesWithinShift(shiftType, breaks);
      const workMinutes = paidMinutesForShift(shiftType, { breakMinutes: actualBreakMinutes });

      rows.push({
        employeeId: employee.id,
        name: employee.name,
        code: employee.code ?? "",
        department: employee.department ?? "",
        shiftName: shiftType.name,
        shiftLabel: shiftType.shortLabel || shiftType.name,
        timeText: shiftType.isWork ? `${shiftType.start}–${shiftType.end}` : "",
        breakText: shiftType.isWork ? breakText(breaks, shiftType) : "",
        breakMinutes: actualBreakMinutes,
        workMinutes,
        overtimeMinutes: overtimeMinutesForShift(shiftType),
        status: !shiftType.isWork || validation.ok ? "OK" : "要確認",
        issues: validation.issues ?? []
      });
    }

    if (rows.length) groups.push({ ...dayInfo, rows });
  }

  return { monthValue, groups };
}
