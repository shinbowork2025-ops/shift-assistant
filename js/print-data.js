import { plannedBreakMinutes, validateBreaks } from "./break-rules.js";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function isValidTime(value) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value.trim())) return false;
  const [hours, minutes] = value.trim().split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function timeToMinutes(value) {
  if (!isValidTime(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function getDaysInMonth(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function dateKey(monthValue, day) {
  return `${monthValue}-${String(day).padStart(2, "0")}`;
}

function dayInfo(monthValue, day) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return {
    day,
    weekday: date.getDay(),
    weekdayLabel: WEEKDAYS[date.getDay()],
    dateValue: dateKey(monthValue, day)
  };
}

function shiftDurationMinutes(shiftType) {
  if (!shiftType?.isWork) return 0;
  const start = timeToMinutes(shiftType.start);
  const end = timeToMinutes(shiftType.end);
  return start === null || end === null || end <= start ? 0 : end - start;
}

function mergedBreakMinutes(breaks = []) {
  const intervals = breaks
    .map((item) => ({ start: timeToMinutes(item?.start), end: timeToMinutes(item?.end) }))
    .filter((item) => item.start !== null && item.end !== null && item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (!intervals.length) return 0;
  let total = 0;
  let currentStart = intervals[0].start;
  let currentEnd = intervals[0].end;
  for (const interval of intervals.slice(1)) {
    if (interval.start <= currentEnd) currentEnd = Math.max(currentEnd, interval.end);
    else {
      total += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }
  return total + currentEnd - currentStart;
}

function paidMinutesForShift(shiftType, breaks = [], useActualBreaks = false) {
  if (!shiftType) return 0;
  if (Number.isFinite(Number(shiftType.paidMinutes))) return Math.max(0, Number(shiftType.paidMinutes));
  if (!shiftType.isWork) return 0;
  const span = shiftDurationMinutes(shiftType);
  const breakMinutes = useActualBreaks ? mergedBreakMinutes(breaks) : plannedBreakMinutes(span);
  return Math.max(0, span - breakMinutes);
}

export function formatDuration(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function shiftMap(workspace) {
  return new Map((workspace.shiftTypes ?? []).map((shift) => [shift.code, shift]));
}

function sortedEmployees(workspace) {
  return [...(workspace.employees ?? [])].sort((a, b) =>
    (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name), "ja")
  );
}

function getShiftCode(workspace, employeeId, monthValue, day) {
  return workspace.shifts?.[monthValue]?.[employeeId]?.[dateKey(monthValue, day)] ?? "";
}

export function buildMonthlyPrintData(workspace) {
  const monthValue = workspace.selectedMonth ?? workspace.targetMonth;
  const days = Array.from({ length: getDaysInMonth(monthValue) }, (_, index) => dayInfo(monthValue, index + 1));
  const shiftsByCode = shiftMap(workspace);
  const rows = sortedEmployees(workspace).map((employee) => {
    let workDays = 0;
    let paidMinutes = 0;
    let overtimeMinutes = 0;
    const cells = days.map(({ day }) => {
      const code = getShiftCode(workspace, employee.id, monthValue, day);
      const shiftType = shiftsByCode.get(code) ?? null;
      const minutes = paidMinutesForShift(shiftType);
      if (minutes > 0) workDays += 1;
      paidMinutes += minutes;
      overtimeMinutes += Math.max(0, Number(shiftType?.overtimeMinutes) || 0);
      return {
        code,
        label: shiftType ? String(shiftType.shortLabel || shiftType.name).slice(0, 4) : "",
        name: shiftType?.name ?? ""
      };
    });

    return {
      employeeId: employee.id,
      name: employee.name,
      code: employee.code ?? "",
      department: employee.department ?? "",
      cells,
      workDays,
      paidMinutes,
      overtimeMinutes
    };
  });

  const legend = (workspace.shiftTypes ?? []).map((shiftType) => ({
    label: String(shiftType.shortLabel || shiftType.name).slice(0, 4),
    name: shiftType.name,
    time: shiftType.isWork ? `${shiftType.start}–${shiftType.end}` : "",
    overtimeMinutes: Math.max(0, Number(shiftType.overtimeMinutes) || 0)
  }));

  return { monthValue, days, rows, legend };
}

function breakText(breaks = []) {
  if (!breaks.length) return "なし";
  return breaks
    .filter((item) => isValidTime(item?.start) && isValidTime(item?.end))
    .map((item) => `${item.start}–${item.end}`)
    .join(" / ") || "未設定";
}

export function buildTransferPrintData(workspace) {
  const monthValue = workspace.selectedMonth ?? workspace.targetMonth;
  const shiftsByCode = shiftMap(workspace);
  const employees = sortedEmployees(workspace);
  const groups = [];

  for (let day = 1; day <= getDaysInMonth(monthValue); day += 1) {
    const info = dayInfo(monthValue, day);
    const rows = [];
    for (const employee of employees) {
      const shiftCode = getShiftCode(workspace, employee.id, monthValue, day);
      if (!shiftCode) continue;
      const shiftType = shiftsByCode.get(shiftCode) ?? null;
      if (!shiftType) continue;
      const breaks = workspace.breaks?.[info.dateValue]?.[employee.id] ?? [];
      const validation = validateBreaks(shiftType, breaks);
      const actualBreakMinutes = mergedBreakMinutes(breaks);
      const workMinutes = paidMinutesForShift(shiftType, breaks, true);

      rows.push({
        employeeId: employee.id,
        name: employee.name,
        code: employee.code ?? "",
        department: employee.department ?? "",
        shiftName: shiftType.name,
        shiftLabel: shiftType.shortLabel || shiftType.name,
        timeText: shiftType.isWork ? `${shiftType.start}–${shiftType.end}` : "",
        breakText: shiftType.isWork ? breakText(breaks) : "",
        breakMinutes: actualBreakMinutes,
        workMinutes,
        overtimeMinutes: Math.max(0, Number(shiftType.overtimeMinutes) || 0),
        status: !shiftType.isWork || validation.ok ? "OK" : "要確認",
        issues: validation.issues ?? []
      });
    }

    if (rows.length) groups.push({ ...info, rows });
  }

  return { monthValue, groups };
}
