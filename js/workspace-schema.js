export const APPLICATION_SCHEMA_VERSION = 4;

export function isWorkspaceEnvelope(candidate) {
  return Boolean(
    candidate
    && typeof candidate === "object"
    && Number(candidate.applicationSchemaVersion) === APPLICATION_SCHEMA_VERSION
    && Array.isArray(candidate.workspaces)
  );
}

export function createBlankWorkspace({ id, name, targetMonth, now, shiftTypes }) {
  return {
    id,
    name,
    targetMonth,
    selectedMonth: targetMonth,
    selectedDate: `${targetMonth}-01`,
    currentView: "month",
    employees: [],
    shiftTypes: structuredClone(shiftTypes),
    shifts: {},
    breaks: {},
    shiftLocks: {},
    dayOffRequests: {},
    createdAt: now,
    updatedAt: now
  };
}

export function wrapLegacyState(candidate, { id, now, defaultMonth, shiftTypes }) {
  const selectedMonth = /^\d{4}-\d{2}$/.test(candidate?.selectedMonth)
    ? candidate.selectedMonth
    : defaultMonth;
  const workspace = {
    ...structuredClone(candidate ?? {}),
    id,
    name: "無題のシフト表",
    targetMonth: selectedMonth,
    selectedMonth,
    selectedDate: /^\d{4}-\d{2}-\d{2}$/.test(candidate?.selectedDate)
      ? candidate.selectedDate
      : `${selectedMonth}-01`,
    currentView: candidate?.currentView === "day" ? "day" : "month",
    employees: Array.isArray(candidate?.employees) ? structuredClone(candidate.employees) : [],
    shiftTypes: Array.isArray(candidate?.shiftTypes) && candidate.shiftTypes.length
      ? structuredClone(candidate.shiftTypes)
      : structuredClone(shiftTypes),
    shifts: candidate?.shifts && typeof candidate.shifts === "object" ? structuredClone(candidate.shifts) : {},
    breaks: candidate?.breaks && typeof candidate.breaks === "object" ? structuredClone(candidate.breaks) : {},
    shiftLocks: candidate?.shiftLocks && typeof candidate.shiftLocks === "object" ? structuredClone(candidate.shiftLocks) : {},
    dayOffRequests: candidate?.dayOffRequests && typeof candidate.dayOffRequests === "object"
      ? structuredClone(candidate.dayOffRequests)
      : {},
    createdAt: candidate?.createdAt ?? candidate?.updatedAt ?? now,
    updatedAt: candidate?.updatedAt ?? now
  };

  return {
    application: "Shift Assistant",
    applicationSchemaVersion: APPLICATION_SCHEMA_VERSION,
    activeWorkspaceId: id,
    workspaces: [workspace],
    settings: {
      lastBackupAt: candidate?.lastBackupAt ?? null
    }
  };
}

export function duplicateWorkspaceRecord(source, { id, name, now }) {
  return {
    ...structuredClone(source),
    id,
    name,
    createdAt: now,
    updatedAt: now
  };
}
