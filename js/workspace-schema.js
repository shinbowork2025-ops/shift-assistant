export const APPLICATION_SCHEMA_VERSION = 5;
export const OLDEST_WORKSPACE_ENVELOPE_VERSION = 4;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isWorkspaceEnvelope(candidate) {
  return Boolean(
    isObject(candidate)
    && Number.isInteger(Number(candidate.applicationSchemaVersion))
    && Array.isArray(candidate.workspaces)
  );
}

function migrateVersion4To5(candidate) {
  return {
    ...candidate,
    applicationSchemaVersion: 5,
    settings: {
      ...isObject(candidate.settings) ? candidate.settings : {},
      lastBackupAt: candidate.settings?.lastBackupAt ?? null,
      lastBackupExportId: candidate.settings?.lastBackupExportId ?? null
    }
  };
}

const ENVELOPE_MIGRATIONS = new Map([
  [4, migrateVersion4To5]
]);

// 複数シフト表形式は、保存時の版から現在版まで1版ずつ変換する。
// 未知の古い版を推測して読み込まず、新しい版を古いアプリで開くことも拒否する。
export function migrateWorkspaceEnvelope(candidate) {
  if (!isWorkspaceEnvelope(candidate)) throw new Error("バックアップの形式が正しくありません。");
  const sourceVersion = Number(candidate.applicationSchemaVersion);
  if (sourceVersion < OLDEST_WORKSPACE_ENVELOPE_VERSION) {
    throw new Error(`保存形式の版${sourceVersion}には対応していません。対応版は${OLDEST_WORKSPACE_ENVELOPE_VERSION}以降です。`);
  }
  if (sourceVersion > APPLICATION_SCHEMA_VERSION) {
    throw new Error(`このバックアップは新しい保存形式（版${sourceVersion}）です。ツールを更新してから復元してください。`);
  }

  let migrated = structuredClone(candidate);
  let version = sourceVersion;
  while (version < APPLICATION_SCHEMA_VERSION) {
    const migration = ENVELOPE_MIGRATIONS.get(version);
    if (!migration) throw new Error(`保存形式の版${version}から版${version + 1}への移行処理がありません。`);
    migrated = migration(migrated);
    version = Number(migrated.applicationSchemaVersion);
  }
  return migrated;
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
    requestedDaysOff: {},
    manualBreakLocks: {},
    coverageRequirements: [],
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
    requestedDaysOff: candidate?.requestedDaysOff && typeof candidate.requestedDaysOff === "object"
      ? structuredClone(candidate.requestedDaysOff)
      : {},
    manualBreakLocks: candidate?.manualBreakLocks && typeof candidate.manualBreakLocks === "object"
      ? structuredClone(candidate.manualBreakLocks)
      : {},
    coverageRequirements: Array.isArray(candidate?.coverageRequirements) ? structuredClone(candidate.coverageRequirements) : [],
    createdAt: candidate?.createdAt ?? candidate?.updatedAt ?? now,
    updatedAt: candidate?.updatedAt ?? now
  };

  return {
    application: "Shift Assistant",
    applicationSchemaVersion: APPLICATION_SCHEMA_VERSION,
    activeWorkspaceId: id,
    workspaces: [workspace],
    settings: {
      lastBackupAt: candidate?.lastBackupAt ?? null,
      lastBackupExportId: null
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
