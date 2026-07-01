import { loadState, saveState } from "./db.js";

export const DEFAULT_SHIFT_TYPES = Object.freeze([
  { code: "early", name: "早番", shortLabel: "早", start: "09:00", end: "18:00", isWork: true },
  { code: "middle", name: "中番", shortLabel: "中", start: "11:00", end: "20:00", isWork: true },
  { code: "late", name: "遅番", shortLabel: "遅", start: "12:00", end: "21:00", isWork: true },
  { code: "short", name: "短時間", shortLabel: "短", start: "09:00", end: "13:00", isWork: true },
  { code: "off", name: "公休", shortLabel: "休", start: "", end: "", isWork: false, paidMinutes: 0 },
  { code: "paid", name: "有休", shortLabel: "有", start: "", end: "", isWork: false, paidMinutes: 450 },
  { code: "request", name: "希望休", shortLabel: "希", start: "", end: "", isWork: false, paidMinutes: 0 }
]);

export const state = {
  schemaVersion: 2,
  selectedMonth: currentMonthValue(),
  selectedDate: currentDateValue(),
  currentView: "month",
  employees: [],
  shiftTypes: structuredClone(DEFAULT_SHIFT_TYPES),
  shifts: {},
  breaks: {},
  updatedAt: null
};

let saveTimer = null;
let statusHandler = () => {};

export function setStatusHandler(handler) {
  statusHandler = handler;
}

export function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function currentDateValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function createId(prefix = "item") {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeState(candidate) {
  if (!candidate || typeof candidate !== "object") return;
  if (!Array.isArray(candidate.employees) || typeof candidate.shifts !== "object" || !candidate.shifts) {
    throw new Error("バックアップの形式が正しくありません。");
  }

  state.schemaVersion = 2;
  state.selectedMonth = /^\d{4}-\d{2}$/.test(candidate.selectedMonth) ? candidate.selectedMonth : currentMonthValue();
  state.selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(candidate.selectedDate)
    ? candidate.selectedDate
    : `${state.selectedMonth}-01`;
  if (!state.selectedDate.startsWith(state.selectedMonth)) state.selectedDate = `${state.selectedMonth}-01`;
  state.currentView = candidate.currentView === "day" ? "day" : "month";
  state.employees = candidate.employees
    .filter((employee) => employee && typeof employee.id === "string" && typeof employee.name === "string")
    .map((employee, index) => ({
      id: employee.id,
      name: employee.name.trim().slice(0, 40),
      code: typeof employee.code === "string" ? employee.code.trim().slice(0, 20) : "",
      department: typeof employee.department === "string" ? employee.department.trim().slice(0, 30) : "",
      order: Number.isFinite(Number(employee.order)) ? Number(employee.order) : index + 1
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"));

  const importedShiftTypes = Array.isArray(candidate.shiftTypes) ? candidate.shiftTypes : DEFAULT_SHIFT_TYPES;
  state.shiftTypes = importedShiftTypes
    .filter((shift) => shift && typeof shift.code === "string" && typeof shift.name === "string")
    .map((shift, index) => normalizeShiftType(shift, index));
  if (state.shiftTypes.length === 0) state.shiftTypes = structuredClone(DEFAULT_SHIFT_TYPES);

  state.shifts = candidate.shifts;
  state.breaks = candidate.breaks && typeof candidate.breaks === "object" ? candidate.breaks : {};
  state.updatedAt = candidate.updatedAt ?? null;
}

function normalizeShiftType(shift, index) {
  const start = isValidTime(shift.start) ? shift.start : "";
  const end = isValidTime(shift.end) ? shift.end : "";
  const isWork = Boolean(shift.isWork ?? (start && end));
  return {
    code: shift.code.trim().slice(0, 30) || `shift-${index + 1}`,
    name: shift.name.trim().slice(0, 40),
    shortLabel: String(shift.shortLabel || shift.name).trim().slice(0, 4),
    start: isWork ? start : "",
    end: isWork ? end : "",
    isWork,
    paidMinutes: Number.isFinite(Number(shift.paidMinutes)) ? Math.max(0, Number(shift.paidMinutes)) : undefined
  };
}

export function isValidTime(value) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value.trim())) return false;
  const [hours, minutes] = value.trim().split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function timeToMinutes(value) {
  if (!isValidTime(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function shiftDurationMinutes(shiftType) {
  if (!shiftType?.isWork) return 0;
  const start = timeToMinutes(shiftType.start);
  const end = timeToMinutes(shiftType.end);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

export function expectedBreakMinutes(shiftType) {
  const duration = shiftDurationMinutes(shiftType);
  if (duration >= 480) return 90;
  if (duration >= 240) return 15;
  return 0;
}

export function paidMinutesForShift(shiftType) {
  if (!shiftType) return 0;
  if (Number.isFinite(Number(shiftType.paidMinutes))) return Math.max(0, Number(shiftType.paidMinutes));
  if (!shiftType.isWork) return 0;
  return Math.max(0, shiftDurationMinutes(shiftType) - expectedBreakMinutes(shiftType));
}

export function getShiftType(code) {
  return state.shiftTypes.find((shift) => shift.code === code) ?? null;
}

export function getDaysInMonth(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

export function dateKey(monthValue, day) {
  return `${monthValue}-${String(day).padStart(2, "0")}`;
}

export function dayFromDate(dateValue) {
  return Number(dateValue.slice(-2));
}

export function getDayInfo(monthValue, day) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return {
    weekday: date.getDay(),
    label: ["日", "月", "火", "水", "木", "金", "土"][date.getDay()]
  };
}

export function getShift(employeeId, day) {
  return state.shifts[state.selectedMonth]?.[employeeId]?.[dateKey(state.selectedMonth, day)] ?? "";
}

export function setShift(employeeId, day, shiftCode) {
  state.shifts[state.selectedMonth] ??= {};
  state.shifts[state.selectedMonth][employeeId] ??= {};
  const key = dateKey(state.selectedMonth, day);

  if (shiftCode) state.shifts[state.selectedMonth][employeeId][key] = shiftCode;
  else delete state.shifts[state.selectedMonth][employeeId][key];

  delete state.breaks[key]?.[employeeId];
  scheduleSave();
}

export function getBreaks(employeeId, dateValue) {
  return state.breaks[dateValue]?.[employeeId] ?? [];
}

export function setBreaksForDate(dateValue, breaksByEmployee) {
  state.breaks[dateValue] = breaksByEmployee;
  scheduleSave();
}

export function employeeSummary(employeeId) {
  const numberOfDays = getDaysInMonth(state.selectedMonth);
  let workDays = 0;
  let paidMinutes = 0;

  for (let day = 1; day <= numberOfDays; day += 1) {
    const shiftType = getShiftType(getShift(employeeId, day));
    const minutes = paidMinutesForShift(shiftType);
    if (minutes > 0) workDays += 1;
    paidMinutes += minutes;
  }
  return { workDays, hours: paidMinutes / 60 };
}

export function daySummary(day) {
  let workers = 0;
  let paidMinutes = 0;
  for (const employee of state.employees) {
    const shiftType = getShiftType(getShift(employee.id, day));
    if (shiftType?.isWork) workers += 1;
    paidMinutes += paidMinutesForShift(shiftType);
  }
  return { workers, hours: paidMinutes / 60 };
}

export function monthDisplayName(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  return `${year}年${month}月`;
}

export function dateDisplayName(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
  return `${year}年${month}月${day}日（${weekday}）`;
}

export function scheduleSave() {
  state.updatedAt = new Date().toISOString();
  statusHandler("未保存の変更があります", false);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 350);
}

export async function saveNow() {
  window.clearTimeout(saveTimer);
  try {
    await saveState(structuredClone(state));
    const savedTime = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    statusHandler(`${savedTime} に端末内へ保存`, false);
  } catch (error) {
    console.error(error);
    statusHandler(`保存失敗: ${error.message}`, true);
  }
}

export async function loadSavedState() {
  const savedState = await loadState();
  if (savedState) normalizeState(savedState);
  return Boolean(savedState);
}
