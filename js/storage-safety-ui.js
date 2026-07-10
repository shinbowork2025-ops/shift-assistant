import { workspaceState } from "./model.js";
import { subscribeExternalStorageChanges } from "./db.js";

let controls = null;
let timer = null;

function relativeBackupText(value) {
  if (!value) return "バックアップ未作成";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "バックアップ日時不明";
  const elapsedHours = Math.max(0, (Date.now() - timestamp) / 3_600_000);
  if (elapsedHours < 1) return "バックアップ1時間以内";
  if (elapsedHours < 24) return `バックアップ${Math.floor(elapsedHours)}時間前`;
  return `バックアップ${Math.floor(elapsedHours / 24)}日前`;
}

function renderBackupAge() {
  if (!controls) return;
  const text = relativeBackupText(workspaceState.settings?.lastBackupAt);
  controls.backup.textContent = text;
  const days = workspaceState.settings?.lastBackupAt
    ? (Date.now() - new Date(workspaceState.settings.lastBackupAt).getTime()) / 86_400_000
    : Infinity;
  controls.backup.classList.toggle("storage-warning", days >= 7);
}

async function requestPersistence() {
  if (!controls) return;
  if (!navigator.storage?.persisted) {
    controls.persistence.textContent = "保存保護: 判定不可";
    return;
  }
  try {
    let persisted = await navigator.storage.persisted();
    if (!persisted && navigator.storage.persist) persisted = await navigator.storage.persist();
    controls.persistence.textContent = persisted ? "保存保護: 有効" : "保存保護: 標準";
    controls.persistence.title = persisted
      ? "ブラウザへ永続保存を要求済みです"
      : "端末容量不足時にブラウザがデータを整理する可能性があります。定期的にバックアップしてください。";
  } catch {
    controls.persistence.textContent = "保存保護: 判定失敗";
  }
}

function showExternalChange(message) {
  if (!controls) return;
  controls.external.hidden = false;
  const time = message?.savedAt
    ? new Date(message.savedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : "先ほど";
  controls.external.textContent = `別タブで${time}に更新されました。このタブでは保存せず再読み込みしてください。`;
  controls.external.focus();
}

export function initializeStorageSafetyUi() {
  if (controls) return controls;
  const topbar = document.querySelector(".app-topbar");
  if (!topbar) return null;

  const summary = document.createElement("div");
  summary.className = "storage-safety-summary";
  const persistence = document.createElement("span");
  persistence.className = "storage-safety-item";
  persistence.textContent = "保存保護: 確認中";
  const backup = document.createElement("span");
  backup.className = "storage-safety-item";
  summary.append(persistence, backup);

  const external = document.createElement("button");
  external.type = "button";
  external.className = "storage-external-warning";
  external.hidden = true;
  external.setAttribute("role", "alert");
  external.addEventListener("click", () => globalThis.location.reload());

  topbar.append(summary, external);
  controls = { summary, persistence, backup, external };
  renderBackupAge();
  void requestPersistence();
  subscribeExternalStorageChanges(showExternalChange);
  globalThis.addEventListener("shift-assistant-backup-created", renderBackupAge);
  timer = globalThis.setInterval(renderBackupAge, 60_000);
  globalThis.addEventListener("pagehide", () => globalThis.clearInterval(timer), { once: true });
  return controls;
}

export { relativeBackupText };
