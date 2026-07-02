import { loadState, saveState } from "./db.js";
import { plannedBreakMinutes } from "./break-rules.js";
import {
  APPLICATION_SCHEMA_VERSION,
  isWorkspaceEnvelope,
  createBlankWorkspace,
  wrapLegacyState,
  duplicateWorkspaceRecord
} from "./workspace-schema.js";

export const DEFAULT_SHIFT_TYPES = Object.freeze([
  { code: "early", name: "早番", shortLabel: "早", start: "09:00", end: "18:00", isWork: true, overtimeMinutes: 0 },
  { code: "middle", name: "中番", shortLabel: "中", start: "11:00", end: "20:00", isWork: true, overtimeMinutes: 0 },
  { code: "late", name: "遅番", shortLabel: "遅", start: "12:00", end: "21:00", isWork: true, overtimeMinutes: 0 },
  { code: "short", name: "短時間", shortLabel: "短", start: "09:00", end: "13:00", isWork: true, overtimeMinutes: 0 },
  { code: "off", name: "公休", shortLabel: "休", start: "", end: "", isWork: false, paidMinutes: 0, overtimeMinutes: 0 },
  { code: "paid", name: "有休", shortLabel: "有", start: "", end: "", isWork: false, paidMinutes: 450, overtimeMinutes: 0 },
  { code: "request", name: "希望休", shortLabel: "希", start: "", end: "", isWork: false, paidMinutes: 0, overtimeMinutes: 0 }
]);

export const state = {
  schemaVersion: 3,
  selectedMonth: currentMonthValue(),
  selectedDate: currentDateValue(),
  currentView: "month",
  employees: [],
  shiftTypes: structuredClone(DEFAULT_SHIFT_TYPES),
  shifts: {},
  breaks: {},
  updatedAt: null
};

export const workspaceState = {
  applicationSchemaVersion: APPLICATION_SCHEMA_VERSION,
  activeWorkspaceId: null,
  workspaces: [],
  settings: { lastBackupAt: null },
  migratedLegacyState: false
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
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nonNegativeMinutes(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function normalizedEmployees(candidate) {
  return (Array.isArray(candidate) ? candidate : [])
    .filter((employee) => employee && typeof employee.id === "string" && typeof employee.name === "string")
    .map((employee, index) => ({
      id: employee.id,
      name: employee.name.trim().slice(0, 40),
      code: typeof employee.code === "string" ? employee.code.trim().slice(0, 20) : "",
      department: typeof employee.department === "string" ? employee.department.trim().slice(0, 30) : "",
      order: Number.isFinite(Number(employee.order)) ? Number(employee.order) : index + 1,
      fixedOvertimeMinutes: nonNegativeMinutes(employee.fixedOvertimeMinutes)
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"));
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
    paidMinutes: Number.isFinite(Number(shift.paidMinutes)) ? Math.max(0, Number(shift.paidMinutes)) : undefined,
    overtimeMinutes: nonNegativeMinutes(shift.overtimeMinutes)
  };
}

function normalizedShiftTypes(candidate) {
  const source = Array.isArray(candidate) && candidate.length ? candidate : DEFAULT_SHIFT_TYPES;
  const result = source
    .filter((shift) => shift && typeof shift.code === "string" && typeof shift.name === "string")
    .map((shift, index) => normalizeShiftType(shift, index));
  return result.length ? result : structuredClone(DEFAULT_SHIFT_TYPES);
}

function normalizeWorkspace(candidate, index = 0) {
  if (!candidate || typeof candidate !== "object") throw new Error("シフト表の形式が正しくありません。");
  const selectedMonth = /^\d{4}-\d{2}$/.test(candidate.selectedMonth ?? candidate.targetMonth)
    ? (candidate.selectedMonth ?? candidate.targetMonth)
    : currentMonthValue();
  let selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(candidate.selectedDate)
    ? candidate.selectedDate
    : `${selectedMonth}-01`;
  if (!selectedDate.startsWith(selectedMonth)) selectedDate = `${selectedMonth}-01`;
  const now = new Date().toISOString();

  return {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : createId(`workspace-${index + 1}`),
    name: String(candidate.name || "無題のシフト表").trim().slice(0, 60) || "無題のシフト表",
    targetMonth: selectedMonth,
    selectedMonth,
    selectedDate,
    currentView: candidate.currentView === "day" ? "day" : "month",
    employees: normalizedEmployees(candidate.employees),
    shiftTypes: normalizedShiftTypes(candidate.shiftTypes),
    shifts: candidate.shifts && typeof candidate.shifts === "object" ? structuredClone(candidate.shifts) : {},
    breaks: candidate.breaks && typeof candidate.breaks === "object" ? structuredClone(candidate.breaks) : {},
    createdAt: candidate.createdAt ?? candidate.updatedAt ?? now,
    updatedAt: candidate.updatedAt ?? now
  };
}

function applyWorkspace(workspace) {
  state.schemaVersion = 3;
  state.selectedMonth = workspace.selectedMonth;
  state.selectedDate = workspace.selectedDate;
  state.currentView = workspace.currentView;
  state.employees = structuredClone(workspace.employees);
  state.shiftTypes = structuredClone(workspace.shiftTypes);
  state.shifts = structuredClone(workspace.shifts);
  state.breaks = structuredClone(workspace.breaks);
  state.updatedAt = workspace.updatedAt;
}

function captureActiveWorkspace() {
  const workspace = workspaceState.workspaces.find((item) => item.id === workspaceState.activeWorkspaceId);
  if (!workspace) return null;
  workspace.targetMonth = state.selectedMonth;
  workspace.selectedMonth = state.selectedMonth;
  workspace.selectedDate = state.selectedDate;
  workspace.currentView = state.currentView;
  workspace.employees = structuredClone(state.employees);
  workspace.shiftTypes = structuredClone(state.shiftTypes);
  workspace.shifts = structuredClone(state.shifts);
  workspace.breaks = structuredClone(state.breaks);
  workspace.updatedAt = state.updatedAt ?? workspace.updatedAt;
  return workspace;
}

function applicationEnvelope() {
  captureActiveWorkspace();
  return {
    application: "Shift Assistant",
    applicationSchemaVersion: APPLICATION_SCHEMA_VERSION,
    activeWorkspaceId: workspaceState.activeWorkspaceId,
    workspaces: structuredClone(workspaceState.workspaces),
    settings: structuredClone(workspaceState.settings)
  };
}

function loadApplicationEnvelope(candidate) {
  if (!isWorkspaceEnvelope(candidate)) throw new Error("バックアップの形式が正しくありません。");
  const workspaces = candidate.workspaces.map((workspace, index) => normalizeWorkspace(workspace, index));
  if (!workspaces.length) throw new Error("バックアップにシフト表がありません。");
  workspaceState.workspaces = workspaces;
  workspaceState.activeWorkspaceId = workspaces.some((item) => item.id === candidate.activeWorkspaceId)
    ? candidate.activeWorkspaceId
    : workspaces[0].id;
  workspaceState.settings = {
    lastBackupAt: candidate.settings?.lastBackupAt ?? null
  };
  const active = getActiveWorkspace();
  applyWorkspace(active);
}

function createInitialWorkspace(name = "無題のシフト表", targetMonth = currentMonthValue()) {
  const now = new Date().toISOString();
  return normalizeWorkspace(createBlankWorkspace({
    id: createId("workspace"),
    name,
    targetMonth,
    now,
    shiftTypes: DEFAULT_SHIFT_TYPES
  }));
}

export function getActiveWorkspace() {
  return workspaceState.workspaces.find((workspace) => workspace.id === workspaceState.activeWorkspaceId) ?? null;
}

export function getWorkspaceList() {
  captureActiveWorkspace();
  return workspaceState.workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    targetMonth: workspace.targetMonth,
    updatedAt: workspace.updatedAt,
    active: workspace.id === workspaceState.activeWorkspaceId
  }));
}

export function getApplicationBackup() {
  return {
    ...applicationEnvelope(),
    exportedAt: new Date().toISOString()
  };
}

export async function restoreApplicationState(candidate) {
  if (isWorkspaceEnvelope(candidate)) {
    loadApplicationEnvelope(candidate);
  } else {
    const now = new Date().toISOString();
    loadApplicationEnvelope(wrapLegacyState(candidate, {
      id: createId("workspace"),
      now,
      defaultMonth: currentMonthValue(),
      shiftTypes: DEFAULT_SHIFT_TYPES
    }));
    workspaceState.migratedLegacyState = true;
  }
  await saveState(applicationEnvelope());
}

export async function switchWorkspace(workspaceId) {
  if (workspaceId === workspaceState.activeWorkspaceId) return;
  captureActiveWorkspace();
  const workspace = workspaceState.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error("選択したシフト表が見つかりません。");
  workspaceState.activeWorkspaceId = workspace.id;
  applyWorkspace(workspace);
  await saveState(applicationEnvelope());
}

export function createWorkspace(name, targetMonth) {
  captureActiveWorkspace();
  const workspace = createInitialWorkspace(name, targetMonth);
  workspaceState.workspaces.push(workspace);
  workspaceState.activeWorkspaceId = workspace.id;
  applyWorkspace(workspace);
  scheduleSave();
  return workspace;
}

export function updateActiveWorkspace(name, targetMonth) {
  const workspace = getActiveWorkspace();
  if (!workspace) throw new Error("編集中のシフト表が見つかりません。");
  const month = /^\d{4}-\d{2}$/.test(targetMonth) ? targetMonth : state.selectedMonth;
  const day = Math.min(Number(state.selectedDate.slice(-2)) || 1, getDaysInMonth(month));
  workspace.name = String(name || workspace.name).trim().slice(0, 60) || "無題のシフト表";
  state.selectedMonth = month;
  state.selectedDate = `${month}-${String(day).padStart(2, "0")}`;
  scheduleSave();
}

export function duplicateActiveWorkspace() {
  captureActiveWorkspace();
  const source = getActiveWorkspace();
  if (!source) throw new Error("複製するシフト表が見つかりません。");
  const now = new Date().toISOString();
  const duplicate = normalizeWorkspace(duplicateWorkspaceRecord(source, {
    id: createId("workspace"),
    name: `${source.name} のコピー`.slice(0, 60),
    now
  }));
  workspaceState.workspaces.push(duplicate);
  workspaceState.activeWorkspaceId = duplicate.id;
  applyWorkspace(duplicate);
  scheduleSave();
  return duplicate;
}

export async function deleteActiveWorkspace() {
  if (workspaceState.workspaces.length <= 1) throw new Error("最後のシフト表は削除できません。");
  const activeId = workspaceState.activeWorkspaceId;
  workspaceState.workspaces = workspaceState.workspaces.filter((workspace) => workspace.id !== activeId);
  workspaceState.activeWorkspaceId = workspaceState.workspaces[0].id;
  applyWorkspace(workspaceState.workspaces[0]);
  await saveState(applicationEnvelope());
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
  return plannedBreakMinutes(shiftDurationMinutes(shiftType));
}

export function paidMinutesForShift(shiftType) {
  if (!shiftType) return 0;
  if (Number.isFinite(Number(shiftType.paidMinutes))) return Math.max(0, Number(shiftType.paidMinutes));
  if (!shiftType.isWork) return 0;
  return Math.max(0, shiftDurationMinutes(shiftType) - expectedBreakMinutes(shiftType));
}

export function overtimeMinutesForShift(shiftType) {
  return shiftType ? nonNegativeMinutes(shiftType.overtimeMinutes) : 0;
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
  const employee = state.employees.find((item) => item.id === employeeId);
  let workDays = 0;
  let paidMinutes = 0;
  let overtimeMinutes = 0;
  for (let day = 1; day <= numberOfDays; day += 1) {
    const shiftType = getShiftType(getShift(employeeId, day));
    const minutes = paidMinutesForShift(shiftType);
    if (minutes > 0) workDays += 1;
    paidMinutes += minutes;
    overtimeMinutes += overtimeMinutesForShift(shiftType);
  }
  const fixedOvertimeMinutes = nonNegativeMinutes(employee?.fixedOvertimeMinutes);
  return {
    workDays,
    hours: paidMinutes / 60,
    overtimeHours: overtimeMinutes / 60,
    fixedOvertimeHours: fixedOvertimeMinutes / 60,
    overtimeRemainingHours: (fixedOvertimeMinutes - overtimeMinutes) / 60,
    overtimeExceededHours: Math.max(0, overtimeMinutes - fixedOvertimeMinutes) / 60
  };
}

export function daySummary(day) {
  let workers = 0;
  let paidMinutes = 0;
  let overtimeMinutes = 0;
  for (const employee of state.employees) {
    const shiftType = getShiftType(getShift(employee.id, day));
    if (shiftType?.isWork) workers += 1;
    paidMinutes += paidMinutesForShift(shiftType);
    overtimeMinutes += overtimeMinutesForShift(shiftType);
  }
  return { workers, hours: paidMinutes / 60, overtimeHours: overtimeMinutes / 60 };
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
  globalThis.clearTimeout(saveTimer);
  saveTimer = globalThis.setTimeout(saveNow, 350);
}

export async function saveNow() {
  globalThis.clearTimeout(saveTimer);
  try {
    await saveState(applicationEnvelope());
    const savedTime = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    statusHandler(`${savedTime} に端末内へ保存`, false);
  } catch (error) {
    console.error(error);
    statusHandler(`保存失敗: ${error.message}`, true);
  }
}

export async function loadSavedState() {
  const savedState = await loadState();
  workspaceState.migratedLegacyState = false;
  if (!savedState) {
    const workspace = createInitialWorkspace();
    workspaceState.workspaces = [workspace];
    workspaceState.activeWorkspaceId = workspace.id;
    workspaceState.settings = { lastBackupAt: null };
    applyWorkspace(workspace);
    await saveState(applicationEnvelope());
    return false;
  }

  if (isWorkspaceEnvelope(savedState)) {
    loadApplicationEnvelope(savedState);
  } else {
    const now = new Date().toISOString();
    const migrated = wrapLegacyState(savedState, {
      id: createId("workspace"),
      now,
      defaultMonth: currentMonthValue(),
      shiftTypes: DEFAULT_SHIFT_TYPES
    });
    loadApplicationEnvelope(migrated);
    workspaceState.migratedLegacyState = true;
    await saveState(applicationEnvelope());
  }
  return true;
}
