import { loadState, saveState } from "./db.js";
import {
  APPLICATION_SCHEMA_VERSION,
  isWorkspaceEnvelope,
  wrapLegacyState,
  duplicateWorkspaceRecord
} from "./workspace-schema.js";
import {
  currentMonthValue,
  currentDateValue,
  isValidTime,
  timeToMinutes,
  minutesToTime,
  getDaysInMonth,
  dateKey,
  dayFromDate,
  getDayInfo,
  monthDisplayName,
  dateDisplayName
} from "./date-time.js";
import {
  nonNegativeMinutes,
  shiftDurationMinutes,
  expectedBreakMinutes,
  paidMinutesForShift,
  overtimeMinutesForShift
} from "./shift-metrics.js";
import { buildMonthOverview } from "./month-overview.js";
import { createId } from "./ids.js";
import { DEFAULT_SHIFT_TYPES } from "./shift-defaults.js";
import { normalizeCoverageRequirements } from "./coverage-requirements.js";
import {
  isShiftLockedInData,
  setShiftLockInData,
  clearMonthShiftLocks,
  removeEmployeeShiftLocks
} from "./shift-locks.js";
import {
  normalizeWorkspace,
  createInitialWorkspace,
  applyWorkspaceToState,
  syncWorkspaceFromState,
  updateWorkspaceMonth
} from "./workspace-normalizer.js";

export {
  currentMonthValue,
  currentDateValue,
  isValidTime,
  timeToMinutes,
  minutesToTime,
  getDaysInMonth,
  dateKey,
  dayFromDate,
  getDayInfo,
  monthDisplayName,
  dateDisplayName,
  nonNegativeMinutes,
  shiftDurationMinutes,
  expectedBreakMinutes,
  paidMinutesForShift,
  overtimeMinutesForShift,
  createId,
  DEFAULT_SHIFT_TYPES
};

export const state = {
  schemaVersion: 4,
  selectedMonth: currentMonthValue(),
  selectedDate: currentDateValue(),
  currentView: "month",
  employees: [],
  shiftTypes: structuredClone(DEFAULT_SHIFT_TYPES),
  shifts: {},
  breaks: {},
  shiftLocks: {},
  coverageRequirements: [],
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
let saveInFlight = null;
let saveQueued = false;
let savePending = false;
let changeRevision = 0;
let statusHandler = () => {};

export function setStatusHandler(handler) {
  statusHandler = handler;
}

export function getActiveWorkspace() {
  return workspaceState.workspaces.find((workspace) => workspace.id === workspaceState.activeWorkspaceId) ?? null;
}

function syncActiveWorkspace() {
  return syncWorkspaceFromState(getActiveWorkspace(), state);
}

function applicationEnvelope() {
  syncActiveWorkspace();
  return {
    application: "Shift Assistant",
    applicationSchemaVersion: APPLICATION_SCHEMA_VERSION,
    activeWorkspaceId: workspaceState.activeWorkspaceId,
    workspaces: workspaceState.workspaces,
    settings: workspaceState.settings
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
  applyWorkspaceToState(state, getActiveWorkspace());
}

export function getWorkspaceList() {
  return workspaceState.workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    targetMonth: workspace.targetMonth,
    updatedAt: workspace.updatedAt,
    active: workspace.id === workspaceState.activeWorkspaceId
  }));
}

export function getApplicationBackup() {
  return structuredClone({
    ...applicationEnvelope(),
    exportedAt: new Date().toISOString()
  });
}

async function persistApplicationStateNow() {
  changeRevision += 1;
  await saveNow();
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
  await persistApplicationStateNow();
}

export async function switchWorkspace(workspaceId) {
  if (workspaceId === workspaceState.activeWorkspaceId) return;
  syncActiveWorkspace();
  const workspace = workspaceState.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error("選択したシフト表が見つかりません。");
  workspaceState.activeWorkspaceId = workspace.id;
  applyWorkspaceToState(state, workspace);
  await persistApplicationStateNow();
}

export function createWorkspace(name, targetMonth) {
  syncActiveWorkspace();
  const workspace = createInitialWorkspace(name, targetMonth);
  workspaceState.workspaces.push(workspace);
  workspaceState.activeWorkspaceId = workspace.id;
  applyWorkspaceToState(state, workspace);
  scheduleSave();
  return workspace;
}

export function updateActiveWorkspace(name, targetMonth) {
  const workspace = getActiveWorkspace();
  if (!workspace) throw new Error("編集中のシフト表が見つかりません。");
  workspace.name = String(name || workspace.name).trim().slice(0, 60) || "無題のシフト表";
  updateWorkspaceMonth(state, targetMonth);
  scheduleSave();
}

export function duplicateActiveWorkspace() {
  syncActiveWorkspace();
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
  applyWorkspaceToState(state, duplicate);
  scheduleSave();
  return duplicate;
}

export async function deleteActiveWorkspace() {
  if (workspaceState.workspaces.length <= 1) throw new Error("最後のシフト表は削除できません。");
  const activeId = workspaceState.activeWorkspaceId;
  workspaceState.workspaces = workspaceState.workspaces.filter((workspace) => workspace.id !== activeId);
  workspaceState.activeWorkspaceId = workspaceState.workspaces[0].id;
  applyWorkspaceToState(state, workspaceState.workspaces[0]);
  await persistApplicationStateNow();
}

export function getShiftType(code) {
  return state.shiftTypes.find((shift) => shift.code === code) ?? null;
}

export function getShift(employeeId, day) {
  return state.shifts[state.selectedMonth]?.[employeeId]?.[dateKey(state.selectedMonth, day)] ?? "";
}

export function isShiftLocked(employeeId, day, monthValue = state.selectedMonth) {
  return isShiftLockedInData(state.shiftLocks, monthValue, employeeId, dateKey(monthValue, day));
}

export function setShiftLock(employeeId, day, locked, options = {}) {
  const monthValue = options.monthValue ?? state.selectedMonth;
  const dateValue = dateKey(monthValue, day);
  setShiftLockInData(state.shiftLocks, monthValue, employeeId, dateValue, Boolean(locked));
  if (options.save !== false) scheduleSave();
  return Boolean(locked);
}

export function clearShiftLocksForMonth(monthValue = state.selectedMonth, options = {}) {
  const count = clearMonthShiftLocks(state.shiftLocks, monthValue);
  if (count > 0 && options.save !== false) scheduleSave();
  return count;
}

export function removeShiftLocksForEmployee(employeeId, options = {}) {
  const count = removeEmployeeShiftLocks(state.shiftLocks, employeeId);
  if (count > 0 && options.save !== false) scheduleSave();
  return count;
}

export function getCoverageRequirements() {
  return state.coverageRequirements ?? [];
}

export function setCoverageRequirements(requirements, options = {}) {
  state.coverageRequirements = normalizeCoverageRequirements(requirements);
  if (options.save !== false) scheduleSave();
  return state.coverageRequirements;
}

function removeEmptyShiftContainers(monthValue, employeeId) {
  const employeeShifts = state.shifts[monthValue]?.[employeeId];
  if (employeeShifts && Object.keys(employeeShifts).length === 0) delete state.shifts[monthValue][employeeId];
  if (state.shifts[monthValue] && Object.keys(state.shifts[monthValue]).length === 0) delete state.shifts[monthValue];
}

function removeEmptyBreakContainers(dateValue) {
  if (state.breaks[dateValue] && Object.keys(state.breaks[dateValue]).length === 0) delete state.breaks[dateValue];
}

export function setShift(employeeId, day, shiftCode, options = {}) {
  if (options.respectLock && isShiftLocked(employeeId, day, options.monthValue ?? state.selectedMonth)) return false;
  const shouldSave = options.save !== false;
  const monthValue = options.monthValue ?? state.selectedMonth;
  const key = dateKey(monthValue, day);

  if (shiftCode) {
    state.shifts[monthValue] ??= {};
    state.shifts[monthValue][employeeId] ??= {};
    state.shifts[monthValue][employeeId][key] = shiftCode;
  } else {
    delete state.shifts[monthValue]?.[employeeId]?.[key];
    removeEmptyShiftContainers(monthValue, employeeId);
  }

  delete state.breaks[key]?.[employeeId];
  removeEmptyBreakContainers(key);
  if (shouldSave) scheduleSave();
  return true;
}

export function getBreaks(employeeId, dateValue) {
  return state.breaks[dateValue]?.[employeeId] ?? [];
}

export function setBreaksForDate(dateValue, breaksByEmployee, options = {}) {
  if (breaksByEmployee && Object.keys(breaksByEmployee).length > 0) state.breaks[dateValue] = breaksByEmployee;
  else delete state.breaks[dateValue];
  if (options.save !== false) scheduleSave();
}

// 1人分の休憩配列だけを差し替える。他の従業員の配列はそのまま維持する。
export function setEmployeeBreaksForDate(dateValue, employeeId, breaksArray, options = {}) {
  const result = structuredClone(state.breaks[dateValue] ?? {});
  if (Array.isArray(breaksArray) && breaksArray.length > 0) result[employeeId] = breaksArray;
  else delete result[employeeId];
  setBreaksForDate(dateValue, result, options);
}

export function employeeSummary(employeeId) {
  const overview = buildMonthOverview({
    monthValue: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts
  });
  return overview.employeeRows.find((row) => row.employee.id === employeeId)?.summary ?? {
    workDays: 0,
    hours: 0,
    overtimeHours: 0,
    fixedOvertimeHours: 0,
    overtimeRemainingHours: 0,
    overtimeExceededHours: 0
  };
}

export function daySummary(day) {
  const overview = buildMonthOverview({
    monthValue: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts
  });
  const summary = overview.daySummaries[day - 1];
  return summary
    ? { workers: summary.workers, hours: summary.paidMinutes / 60, overtimeHours: summary.overtimeMinutes / 60 }
    : { workers: 0, hours: 0, overtimeHours: 0 };
}

export function scheduleSave() {
  state.updatedAt = new Date().toISOString();
  requestSave();
}

// 表示月・対象日・ビューなどの画面状態だけを保存する。
// データ編集ではないため、切替欄に表示する更新日時は変更しない。
export function scheduleViewStateSave() {
  requestSave();
}

function requestSave() {
  syncActiveWorkspace();
  changeRevision += 1;
  savePending = true;
  statusHandler("未保存の変更があります", false);
  globalThis.clearTimeout(saveTimer);
  saveTimer = globalThis.setTimeout(() => {
    void saveNow().catch(() => {});
  }, 350);
}

async function persistCurrentRevision() {
  const revision = changeRevision;
  try {
    await saveState(applicationEnvelope());
    if (revision === changeRevision) {
      savePending = false;
      const savedTime = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      statusHandler(`${savedTime} に端末内へ保存`, false);
    } else {
      saveQueued = true;
    }
  } catch (error) {
    console.error(error);
    statusHandler(`保存失敗: ${error.message}`, true);
    throw error;
  }
}

export async function saveNow() {
  globalThis.clearTimeout(saveTimer);
  if (saveInFlight) {
    saveQueued = true;
    return saveInFlight;
  }

  saveInFlight = persistCurrentRevision().finally(async () => {
    saveInFlight = null;
    if (saveQueued) {
      saveQueued = false;
      await saveNow();
    }
  });
  return saveInFlight;
}

// タブを閉じる・裏へ回る直前に、デバウンス待ちの変更を即時保存する。
export function flushPendingSave() {
  if (!savePending && !saveInFlight) return Promise.resolve();
  return saveNow();
}

export async function loadSavedState() {
  const savedState = await loadState();
  workspaceState.migratedLegacyState = false;
  if (!savedState) {
    const workspace = createInitialWorkspace();
    workspaceState.workspaces = [workspace];
    workspaceState.activeWorkspaceId = workspace.id;
    workspaceState.settings = { lastBackupAt: null };
    applyWorkspaceToState(state, workspace);
    await persistApplicationStateNow();
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
    await persistApplicationStateNow();
  }
  return true;
}
