import test from "node:test";
import assert from "node:assert/strict";
import {
  APPLICATION_SCHEMA_VERSION,
  OLDEST_WORKSPACE_ENVELOPE_VERSION,
  isWorkspaceEnvelope,
  migrateWorkspaceEnvelope,
  createBlankWorkspace,
  wrapLegacyState,
  duplicateWorkspaceRecord
} from "../js/workspace-schema.js";

const shiftTypes = [
  { code: "01", name: "01", start: "09:00", end: "18:00", isWork: true }
];

test("既存の単一シフト表を無題のワークスペースへ移行する", () => {
  const legacy = {
    selectedMonth: "2026-07",
    selectedDate: "2026-07-15",
    employees: [{ id: "e1", name: "田中" }],
    shiftTypes,
    shifts: { "2026-07": { e1: { "2026-07-15": "01" } } },
    breaks: { "2026-07-15": { e1: [{ start: "12:00", end: "13:00" }] } },
    updatedAt: "2026-07-01T00:00:00.000Z"
  };

  const migrated = wrapLegacyState(legacy, {
    id: "workspace-1",
    now: "2026-07-02T00:00:00.000Z",
    defaultMonth: "2026-07",
    shiftTypes
  });

  assert.equal(isWorkspaceEnvelope(migrated), true);
  assert.equal(migrated.applicationSchemaVersion, APPLICATION_SCHEMA_VERSION);
  assert.equal(migrated.activeWorkspaceId, "workspace-1");
  assert.equal(migrated.workspaces.length, 1);
  assert.equal(migrated.workspaces[0].name, "無題のシフト表");
  assert.equal(migrated.workspaces[0].employees[0].name, "田中");
  assert.equal(migrated.workspaces[0].shifts["2026-07"].e1["2026-07-15"], "01");
  assert.equal(migrated.workspaces[0].breaks["2026-07-15"].e1[0].start, "12:00");
});

test("版4の複数シフト表を版5へ移行し、全データを維持する", () => {
  const version4 = {
    application: "Shift Assistant",
    applicationSchemaVersion: 4,
    activeWorkspaceId: "workspace-2",
    settings: { lastBackupAt: "2026-07-01T00:00:00.000Z" },
    workspaces: [
      {
        id: "workspace-1",
        name: "園芸",
        selectedMonth: "2026-07",
        employees: [{ id: "e1", name: "田中" }],
        shiftTypes,
        shifts: { "2026-07": { e1: { "2026-07-01": "01" } } }
      },
      {
        id: "workspace-2",
        name: "資材",
        selectedMonth: "2026-08",
        employees: [{ id: "e2", name: "佐藤" }],
        shiftTypes,
        shifts: { "2026-08": { e2: { "2026-08-01": "01" } } }
      }
    ]
  };

  assert.equal(isWorkspaceEnvelope(version4), true);
  const migrated = migrateWorkspaceEnvelope(version4);
  assert.equal(migrated.applicationSchemaVersion, APPLICATION_SCHEMA_VERSION);
  assert.equal(migrated.activeWorkspaceId, "workspace-2");
  assert.equal(migrated.workspaces.length, 2);
  assert.equal(migrated.workspaces[0].employees[0].name, "田中");
  assert.equal(migrated.workspaces[1].shifts["2026-08"].e2["2026-08-01"], "01");
  assert.equal(migrated.settings.lastBackupAt, "2026-07-01T00:00:00.000Z");
  assert.equal(migrated.settings.lastBackupExportId, null);
  assert.equal(version4.applicationSchemaVersion, 4);
});

test("未対応の古い版と新しい版を推測して読み込まない", () => {
  const envelope = { applicationSchemaVersion: OLDEST_WORKSPACE_ENVELOPE_VERSION, workspaces: [] };
  assert.throws(
    () => migrateWorkspaceEnvelope({ ...envelope, applicationSchemaVersion: OLDEST_WORKSPACE_ENVELOPE_VERSION - 1 }),
    /対応していません/
  );
  assert.throws(
    () => migrateWorkspaceEnvelope({ ...envelope, applicationSchemaVersion: APPLICATION_SCHEMA_VERSION + 1 }),
    /ツールを更新/
  );
});

test("新規ワークスペースは空の独立データを持つ", () => {
  const workspace = createBlankWorkspace({
    id: "workspace-new",
    name: "園芸",
    targetMonth: "2026-08",
    now: "2026-07-02T00:00:00.000Z",
    shiftTypes
  });

  assert.equal(workspace.name, "園芸");
  assert.equal(workspace.selectedMonth, "2026-08");
  assert.deepEqual(workspace.employees, []);
  assert.deepEqual(workspace.shifts, {});
  assert.notEqual(workspace.shiftTypes, shiftTypes);
});

test("複製したワークスペースは元データと参照を共有しない", () => {
  const source = createBlankWorkspace({
    id: "workspace-source",
    name: "園芸",
    targetMonth: "2026-08",
    now: "2026-07-02T00:00:00.000Z",
    shiftTypes
  });
  source.employees.push({ id: "e1", name: "田中" });

  const duplicate = duplicateWorkspaceRecord(source, {
    id: "workspace-copy",
    name: "園芸 のコピー",
    now: "2026-07-03T00:00:00.000Z"
  });
  duplicate.employees[0].name = "佐藤";

  assert.equal(source.employees[0].name, "田中");
  assert.equal(duplicate.employees[0].name, "佐藤");
  assert.equal(duplicate.id, "workspace-copy");
});
