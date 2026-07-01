import { loadState, saveState } from "./db.js";

export const SHIFT_TYPES = Object.freeze({
  "": { label: "", hours: 0 },
  early: { label: "早", hours: 8 },
  middle: { label: "中", hours: 8 },
  late: { label: "遅", hours: 8 },
  short: { label: "短", hours: 4 },
  off: { label: "休", hours: 0 },
  paid: { label: "有", hours: 8 },
  request: { label: "希", hours: 0 }
});

export const state = {
  schemaVersion: 1,
  selectedMonth: currentMonthValue(),
  employees: [],
  shifts: {},
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

export function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `employee-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeState(candidate) {
  if (!candidate || typeof candidate !== "object") return;
  if (!Array.isArray(candidate.employees) || typeof candidate.shifts !== "object" || !candidate.shifts) {
    throw new Error("バックアップの形式が正しくありません。");
  }

  state.schemaVersion = 1;
  state.selectedMonth = /^\d{4}-\d{2}$/.test(candidate.selectedMonth) ? candidate.selectedMonth : currentMonthValue();
  state.employees = candidate.employees
    .filter((employee) => employee && typeof employee.id === "string" && typeof employee.name === "string")
    .map((employee) => ({
      id: employee.id,
      name: employee.name.trim().slice(0, 40),
      code: typeof employee.code === "string" ? employee.code.trim().slice(0, 12) : ""
    }));
  state.shifts = candidate.shifts;
  state.updatedAt = candidate.updatedAt ?? null;
}

export function getDaysInMonth(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

export function dateKey(monthValue, day) {
  return `${monthValue}-${String(day).padStart(2, "0")}`;
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

export function setShift(employeeId, day, shiftType) {
  state.shifts[state.selectedMonth] ??= {};
  state.shifts[state.selectedMonth][employeeId] ??= {};
  const key = dateKey(state.selectedMonth, day);

  if (shiftType) state.shifts[state.selectedMonth][employeeId][key] = shiftType;
  else delete state.shifts[state.selectedMonth][employeeId][key];

  scheduleSave();
}

export function employeeSummary(employeeId) {
  const numberOfDays = getDaysInMonth(state.selectedMonth);
  let workDays = 0;
  let hours = 0;

  for (let day = 1; day <= numberOfDays; day += 1) {
    const shift = SHIFT_TYPES[getShift(employeeId, day)] ?? SHIFT_TYPES[""];
    if (shift.hours > 0) workDays += 1;
    hours += shift.hours;
  }
  return { workDays, hours };
}

export function daySummary(day) {
  let workers = 0;
  let hours = 0;
  for (const employee of state.employees) {
    const shift = SHIFT_TYPES[getShift(employee.id, day)] ?? SHIFT_TYPES[""];
    if (shift.hours > 0) workers += 1;
    hours += shift.hours;
  }
  return { workers, hours };
}

export function monthDisplayName(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  return `${year}年${month}月`;
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
