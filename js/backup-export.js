import { APPLICATION_SCHEMA_VERSION, isWorkspaceEnvelope } from "./workspace-schema.js";

export const BACKUP_EXPORT_FORMAT = "shift-assistant-backup";
export const BACKUP_EXPORT_VERSION = 1;

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256Text(text) {
  if (!globalThis.crypto?.subtle) throw new Error("バックアップの整合性確認に必要なSHA-256を利用できません。");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToHex(digest);
}

function workspaceSummary(workspace) {
  return {
    workspaceId: workspace.id ?? "",
    workspaceName: workspace.name ?? "",
    targetMonth: workspace.selectedMonth ?? workspace.targetMonth ?? "",
    employeeCount: Array.isArray(workspace.employees) ? workspace.employees.length : 0
  };
}

// 情報システム側の転送・世代管理処理が、payloadを解釈せずに管理情報を読める形にする。
export async function buildBackupExport(payload, options = {}) {
  if (!isWorkspaceEnvelope(payload)) throw new Error("バックアップ対象の保存形式が正しくありません。");
  const createdAt = options.createdAt ?? new Date().toISOString();
  const exportId = options.exportId ?? globalThis.crypto?.randomUUID?.();
  if (!exportId) throw new Error("バックアップ識別子を作成できません。");
  const clonedPayload = structuredClone(payload);
  const payloadText = JSON.stringify(clonedPayload);
  const payloadSha256 = await (options.digest ?? sha256Text)(payloadText);
  return {
    format: BACKUP_EXPORT_FORMAT,
    formatVersion: BACKUP_EXPORT_VERSION,
    exportId,
    createdAt,
    producer: {
      application: "Shift Assistant",
      applicationSchemaVersion: APPLICATION_SCHEMA_VERSION
    },
    summary: {
      activeWorkspaceId: clonedPayload.activeWorkspaceId ?? "",
      workspaceCount: clonedPayload.workspaces.length,
      workspaces: clonedPayload.workspaces.map(workspaceSummary)
    },
    payloadSha256,
    payload: clonedPayload
  };
}

export function isBackupExport(candidate) {
  return Boolean(
    candidate
    && typeof candidate === "object"
    && candidate.format === BACKUP_EXPORT_FORMAT
    && Number(candidate.formatVersion) === BACKUP_EXPORT_VERSION
    && typeof candidate.exportId === "string"
    && typeof candidate.payloadSha256 === "string"
    && isWorkspaceEnvelope(candidate.payload)
  );
}

export async function extractBackupPayload(candidate, options = {}) {
  if (!isBackupExport(candidate)) throw new Error("バックアップ出力ファイルの形式が正しくありません。");
  const payload = structuredClone(candidate.payload);
  const actualHash = await (options.digest ?? sha256Text)(JSON.stringify(payload));
  if (actualHash !== candidate.payloadSha256) {
    throw new Error("バックアップの内容が作成後に変更されているため、復元を中止しました。");
  }
  return payload;
}
