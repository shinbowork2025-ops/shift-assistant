import { currentMonthValue, getDaysInMonth, isDateValue, isMonthValue, isValidTime } from "./date-time.js";
import { createId } from "./ids.js";
import { normalizeEmploymentType } from "./employment-types.js";
import { normalizeCoverageRequirements } from "./coverage-requirements.js";
import { DEFAULT_SHIFT_TYPES } from "./shift-defaults.js";
import { migrateShiftCatalog } from "./shift-catalog-migration.js";
import { nonNegativeMinutes } from "./shift-metrics.js";
import { normalizeShiftLocks } from "./shift-locks.js";
import { normalizeRequestedDaysOff } from "./requested-days-off.js";
import { normalizeManualBreakLocks } from "./manual-break-locks.js";
import {
  normalizeFixedDaysOff,
  normalizeRestPatternId,
  normalizeRestPatternOffset,
  normalizeTargetDaysOff
} from "./rest-patterns.js";
import {
  normalizeAllowedShiftCodes,
  normalizeAvoidLateEarly,
  normalizePreferredShiftCode
} from "./work-shift-preferences.js";
import { createBlankWorkspace } from "./workspace-schema.js";

const VALID_VIEWS = new Set(["month", "day", "print"]);
let workspaceMigrationPending = false;

export function normalizeStringList(candidate, maxItems = 30) {
  const source = Array.isArray(candidate)
    ? candidate
    : String(candidate ?? "").split(/[、,;\n]/);
  return [...new Set(source.map((item) => String(item ?? "").trim().slice(0, 40)).filter(Boolean))]
    .slice(0, maxItems);
}

export function consumeWorkspaceMigrationFlag() {
  const migrated = workspaceMigrationPending;
  workspaceMigrationPending = false;
  return migrated;
}

export function compareEmployeeOrder(a, b) {
  return a.order - b.order || a.name.localeCompare(b.name, "ja");
}

export function normalizeEmployees(candidate) {
  return (Array.isArray(candidate) ? candidate : [])
    .filter((employee) => employee && typeof employee.id === "string" && typeof employee.name === "string")
    .map((employee, index) => ({
      id: employee.id,
      name: employee.name.trim().slice(0, 40),
      code: typeof employee.code === "string" ? employee.code.trim().slice(0, 20) : "",
      department: typeof employee.department === "string" ? employee.department.trim().slice(0, 30) : "",
      qualifications: normalizeStringList(employee.qualifications),
      order: Number.isFinite(Number(employee.order)) ? Number(employee.order) : index + 1,
      employmentType: normalizeEmploymentType(employee.employmentType),
      fixedOvertimeMinutes: nonNegativeMinutes(employee.fixedOvertimeMinutes),
      restPatternId: normalizeRestPatternId(employee.restPatternId),
      restPatternOffset: normalizeRestPatternOffset(employee.restPatternOffset),
      targetDaysOff: normalizeTargetDaysOff(employee.targetDaysOff),
      fixedDaysOff: normalizeFixedDaysOff(employee.fixedDaysOff),
      allowedShiftCodes: normalizeAllowedShiftCodes(employee.allowedShiftCodes),
      preferredShiftCode: normalizePreferredShiftCode(employee.preferredShiftCode),
      avoidLateEarly: normalizeAvoidLateEarly(employee.avoidLateEarly)
    }))
    .sort(compareEmployeeOrder);
}

export function normalizeShiftType(shift, index) {
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

export function normalizeShiftTypes(candidate) {
  const source = Array.isArray(candidate) && candidate.length ? candidate : DEFAULT_SHIFT_TYPES;
  const result = source
    .filter((shift) => shift && typeof shift.code === "string" && typeof shift.name === "string")
    .map((shift, index) => normalizeShiftType(shift, index));
  return result.length ? result : structuredClone(DEFAULT_SHIFT_TYPES);
}

export function normalizeWorkspace(candidate, index = 0) {
  if (!candidate || typeof candidate !== "object") throw new Error("シフト表の形式が正しくありません。");
  const selectedMonth = isMonthValue(candidate.selectedMonth ?? candidate.targetMonth)
    ? (candidate.selectedMonth ?? candidate.targetMonth)
    : currentMonthValue();
  let selectedDate = isDateValue(candidate.selectedDate)
    ? candidate.selectedDate
    : `${selectedMonth}-01`;
  if (!selectedDate.startsWith(selectedMonth)) selectedDate = `${selectedMonth}-01`;
  const now = new Date().toISOString();

  const migration = migrateShiftCatalog({
    employees: normalizeEmployees(candidate.employees),
    shiftTypes: normalizeShiftTypes(candidate.shiftTypes),
    shifts: candidate.shifts && typeof candidate.shifts === "object" ? structuredClone(candidate.shifts) : {},
    breaks: candidate.breaks && typeof candidate.breaks === "object" ? structuredClone(candidate.breaks) : {},
    shiftLocks: normalizeShiftLocks(candidate.shiftLocks),
    defaultShiftTypes: DEFAULT_SHIFT_TYPES
  });
  if (migration.migrated) workspaceMigrationPending = true;

  return {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : createId(`workspace-${index + 1}`),
    name: String(candidate.name || "無題のシフト表").trim().slice(0, 60) || "無題のシフト表",
    targetMonth: selectedMonth,
    selectedMonth,
    selectedDate,
    currentView: VALID_VIEWS.has(candidate.currentView) ? candidate.currentView : "month",
    employees: migration.employees,
    shiftTypes: migration.shiftTypes,
    shifts: migration.shifts,
    breaks: migration.breaks,
    shiftLocks: migration.shiftLocks,
    requestedDaysOff: normalizeRequestedDaysOff(candidate.requestedDaysOff),
    manualBreakLocks: normalizeManualBreakLocks(candidate.manualBreakLocks),
    coverageRequirements: normalizeCoverageRequirements(candidate.coverageRequirements),
    createdAt: candidate.createdAt ?? candidate.updatedAt ?? now,
    updatedAt: candidate.updatedAt ?? now
  };
}

export function createInitialWorkspace(name = "無題のシフト表", targetMonth = currentMonthValue()) {
  const now = new Date().toISOString();
  return normalizeWorkspace(createBlankWorkspace({
    id: createId("workspace"),
    name,
    targetMonth,
    now,
    shiftTypes: DEFAULT_SHIFT_TYPES
  }));
}

export function applyWorkspaceToState(targetState, workspace) {
  targetState.schemaVersion = 4;
  targetState.selectedMonth = workspace.selectedMonth;
  targetState.selectedDate = workspace.selectedDate;
  targetState.currentView = VALID_VIEWS.has(workspace.currentView) ? workspace.currentView : "month";
  targetState.employees = structuredClone(workspace.employees);
  targetState.shiftTypes = structuredClone(workspace.shiftTypes);
  targetState.shifts = structuredClone(workspace.shifts);
  targetState.breaks = structuredClone(workspace.breaks);
  targetState.shiftLocks = structuredClone(workspace.shiftLocks);
  targetState.requestedDaysOff = structuredClone(workspace.requestedDaysOff ?? {});
  targetState.manualBreakLocks = structuredClone(workspace.manualBreakLocks ?? {});
  targetState.coverageRequirements = structuredClone(workspace.coverageRequirements ?? []);
  targetState.updatedAt = workspace.updatedAt;
}

export function syncWorkspaceFromState(workspace, sourceState) {
  if (!workspace) return null;
  workspace.targetMonth = sourceState.selectedMonth;
  workspace.selectedMonth = sourceState.selectedMonth;
  workspace.selectedDate = sourceState.selectedDate;
  workspace.currentView = VALID_VIEWS.has(sourceState.currentView) ? sourceState.currentView : "month";
  workspace.employees = sourceState.employees;
  workspace.shiftTypes = sourceState.shiftTypes;
  workspace.shifts = sourceState.shifts;
  workspace.breaks = sourceState.breaks;
  workspace.shiftLocks = sourceState.shiftLocks;
  workspace.requestedDaysOff = sourceState.requestedDaysOff ?? {};
  workspace.manualBreakLocks = sourceState.manualBreakLocks ?? {};
  workspace.coverageRequirements = sourceState.coverageRequirements ?? [];
  workspace.updatedAt = sourceState.updatedAt ?? workspace.updatedAt;
  return workspace;
}

export function updateWorkspaceMonth(targetState, targetMonth) {
  const month = isMonthValue(targetMonth) ? targetMonth : targetState.selectedMonth;
  const day = Math.min(Number(targetState.selectedDate.slice(-2)) || 1, getDaysInMonth(month));
  targetState.selectedMonth = month;
  targetState.selectedDate = `${month}-${String(day).padStart(2, "0")}`;
}
