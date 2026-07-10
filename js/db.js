const DB_NAME = "shift-assistant";
const DB_VERSION = 1;
const STORE_NAME = "documents";
const STATE_KEY = "app-state";
const CHANNEL_NAME = "shift-assistant-storage";

const writerId = globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}-${Math.random()}`;
const storageListeners = new Set();
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
let databasePromise = null;
let lastKnownRevision = 0;

export class StorageConflictError extends Error {
  constructor(message = "別のタブで保存データが更新されました。このタブを再読み込みしてから編集を続けてください。") {
    super(message);
    this.name = "StorageConflictError";
    this.code = "STORAGE_CONFLICT";
  }
}

channel?.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.writerId === writerId) return;
  if (Number(message.revision) > lastKnownRevision) {
    for (const listener of storageListeners) listener(message);
  }
});

export function subscribeExternalStorageChanges(listener) {
  storageListeners.add(listener);
  return () => storageListeners.delete(listener);
}

export function getKnownStorageRevision() {
  return lastKnownRevision;
}

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("IndexedDBを開けませんでした。"));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("別のタブがデータベース更新を妨げています。"));
    };
  });

  return databasePromise;
}

function requestResult(request, fallbackMessage) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error(fallbackMessage));
  });
}

export async function loadState() {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
  const result = await requestResult(request, "保存データを読み込めませんでした。");
  lastKnownRevision = Math.max(0, Number(result?.storageRevision) || 0);
  return result;
}

export async function saveState(state) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    let savedRevision = null;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { transaction.abort(); } catch { /* transaction may already be inactive */ }
      reject(error);
    };

    const readRequest = store.get(STATE_KEY);
    readRequest.onerror = () => fail(readRequest.error ?? new Error("保存前の競合確認に失敗しました。"));
    readRequest.onsuccess = () => {
      const current = readRequest.result ?? null;
      const currentRevision = Math.max(0, Number(current?.storageRevision) || 0);
      const writtenByAnotherTab = current?.storageWriterId && current.storageWriterId !== writerId;
      if (currentRevision > lastKnownRevision && writtenByAnotherTab) {
        fail(new StorageConflictError());
        return;
      }

      savedRevision = currentRevision + 1;
      const nextState = structuredClone(state);
      nextState.storageRevision = savedRevision;
      nextState.storageWriterId = writerId;
      nextState.storageSavedAt = new Date().toISOString();
      const putRequest = store.put(nextState, STATE_KEY);
      putRequest.onerror = () => fail(putRequest.error ?? new Error("保存処理に失敗しました。"));
    };

    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      lastKnownRevision = savedRevision ?? lastKnownRevision;
      channel?.postMessage({
        type: "saved",
        writerId,
        revision: lastKnownRevision,
        savedAt: new Date().toISOString()
      });
      resolve();
    };
    transaction.onerror = () => fail(transaction.error ?? new Error("保存処理に失敗しました。"));
    transaction.onabort = () => {
      if (!settled) fail(transaction.error ?? new Error("保存処理が中断されました。"));
    };
  });
}
