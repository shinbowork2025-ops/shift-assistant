import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_EXPORT_FORMAT,
  BACKUP_EXPORT_VERSION,
  buildBackupExport,
  extractBackupPayload,
  isBackupExport,
  sha256Text
} from "../js/backup-export.js";
import { APPLICATION_SCHEMA_VERSION } from "../js/workspace-schema.js";

function payload() {
  return {
    application: "Shift Assistant",
    applicationSchemaVersion: APPLICATION_SCHEMA_VERSION,
    activeWorkspaceId: "w1",
    settings: { lastBackupAt: "2026-07-18T00:00:00.000Z", lastBackupExportId: "export-1" },
    workspaces: [{
      id: "w1",
      name: "園芸",
      selectedMonth: "2026-07",
      employees: [{ id: "e1", code: "E001", name: "田中" }],
      shifts: { "2026-07": { e1: { "2026-07-01": "01" } } }
    }]
  };
}

const digest = async (text) => `digest:${text.length}`;

test("ブラウザ標準のSHA-256で既知のハッシュ値を生成する", async () => {
  assert.equal(
    await sha256Text("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("転送側が管理情報を読めるバックアップ出力を構築する", async () => {
  const result = await buildBackupExport(payload(), {
    createdAt: "2026-07-18T09:00:00.000Z",
    exportId: "export-1",
    digest
  });

  assert.equal(result.format, BACKUP_EXPORT_FORMAT);
  assert.equal(result.formatVersion, BACKUP_EXPORT_VERSION);
  assert.equal(result.exportId, "export-1");
  assert.equal(result.producer.applicationSchemaVersion, APPLICATION_SCHEMA_VERSION);
  assert.equal(result.summary.workspaceCount, 1);
  assert.equal(result.summary.workspaces[0].employeeCount, 1);
  assert.equal(isBackupExport(result), true);
  assert.deepEqual(await extractBackupPayload(result, { digest }), payload());
});

test("内容が変更されたバックアップは復元を拒否する", async () => {
  const result = await buildBackupExport(payload(), { exportId: "export-1", digest });
  result.payload.workspaces[0].employees[0].name = "改変後";
  await assert.rejects(() => extractBackupPayload(result, { digest }), /内容が作成後に変更/);
});

test("従来の保存データをバックアップ出力と誤認しない", () => {
  assert.equal(isBackupExport(payload()), false);
});
