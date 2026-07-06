import { state, getActiveWorkspace, scheduleSave } from "./model.js";
import { createHistoryStack } from "./history-stack.js";
import { createHistoryPatch, applyHistoryPatch } from "./history-patch.js";

const HISTORY_LIMIT = 50;
const stacks = new Map();
const listeners = new Set();

function activeWorkspaceId() {
  return getActiveWorkspace()?.id ?? "";
}

function stackFor(workspaceId = activeWorkspaceId()) {
  if (!workspaceId) return null;
  if (!stacks.has(workspaceId)) stacks.set(workspaceId, createHistoryStack(HISTORY_LIMIT));
  return stacks.get(workspaceId);
}

function currentWorkspaceDocument() {
  const workspace = getActiveWorkspace();
  if (!workspace) return null;
  return {
    workspaceId: workspace.id,
    name: workspace.name,
    selectedMonth: state.selectedMonth,
    selectedDate: state.selectedDate,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    breaks: state.breaks,
    shiftLocks: state.shiftLocks,
    coverageRequirements: state.coverageRequirements
  };
}

function snapshotActiveWorkspace() {
  const current = currentWorkspaceDocument();
  return current ? structuredClone(current) : null;
}

function applySnapshot(snapshot) {
  const workspace = getActiveWorkspace();
  if (!workspace || workspace.id !== snapshot?.workspaceId) {
    throw new Error("履歴の対象シフト表が現在のシフト表と一致しません。");
  }

  workspace.name = snapshot.name;
  workspace.targetMonth = snapshot.selectedMonth;
  workspace.selectedMonth = snapshot.selectedMonth;
  workspace.selectedDate = snapshot.selectedDate;
  state.selectedMonth = snapshot.selectedMonth;
  state.selectedDate = snapshot.selectedDate;
  state.employees = structuredClone(snapshot.employees);
  state.shiftTypes = structuredClone(snapshot.shiftTypes);
  state.shifts = structuredClone(snapshot.shifts);
  state.breaks = structuredClone(snapshot.breaks);
  state.shiftLocks = structuredClone(snapshot.shiftLocks ?? {});
  state.coverageRequirements = structuredClone(snapshot.coverageRequirements ?? []);
  scheduleSave();
}

function notify() {
  const status = getHistoryStatus();
  for (const listener of listeners) listener(status);
}

function recordSnapshots(label, before, after) {
  if (!before || !after || after.workspaceId !== before.workspaceId) return false;
  const patch = createHistoryPatch(before, after);
  if (!patch.length) return false;
  stackFor(before.workspaceId)?.record({ label, workspaceId: before.workspaceId, patch });
  notify();
  return true;
}

function applyEntry(entry, direction) {
  const current = currentWorkspaceDocument();
  if (!current || current.workspaceId !== entry?.workspaceId) {
    throw new Error("履歴の対象シフト表が現在のシフト表と一致しません。");
  }
  applyHistoryPatch(current, entry.patch, direction);
  applySnapshot(current);
}

export function runWithHistory(label, operation) {
  const before = snapshotActiveWorkspace();
  if (!before) return operation();

  const finish = (result) => {
    recordSnapshots(label, before, currentWorkspaceDocument());
    return result;
  };

  const result = operation();
  if (result && typeof result.then === "function") return result.then(finish);
  return finish(result);
}

export function beginHistoryTransaction(label) {
  const before = snapshotActiveWorkspace();
  if (!before) return null;
  return {
    label,
    workspaceId: before.workspaceId,
    before,
    completed: false
  };
}

export function commitHistoryTransaction(transaction) {
  if (!transaction || transaction.completed) return false;
  transaction.completed = true;
  return recordSnapshots(transaction.label, transaction.before, currentWorkspaceDocument());
}

export function cancelHistoryTransaction(transaction, restore = false) {
  if (!transaction || transaction.completed) return false;
  transaction.completed = true;
  if (restore) applySnapshot(transaction.before);
  notify();
  return true;
}

export function undoHistory() {
  const entry = stackFor()?.undo();
  if (!entry) return null;
  applyEntry(entry, "before");
  notify();
  return entry.label;
}

export function redoHistory() {
  const entry = stackFor()?.redo();
  if (!entry) return null;
  applyEntry(entry, "after");
  notify();
  return entry.label;
}

export function getHistoryStatus() {
  return stackFor()?.status() ?? {
    canUndo: false,
    canRedo: false,
    undoLabel: "",
    redoLabel: "",
    undoCount: 0,
    redoCount: 0,
    limit: HISTORY_LIMIT
  };
}

export function subscribeHistory(listener) {
  listeners.add(listener);
  listener(getHistoryStatus());
  return () => listeners.delete(listener);
}

export function refreshHistoryStatus() {
  notify();
}

export function clearHistory(workspaceId = null) {
  if (workspaceId) stacks.delete(workspaceId);
  else stacks.clear();
  notify();
}
