import {
  state,
  workspaceState,
  loadSavedState,
  setStatusHandler,
  flushPendingSave,
  scheduleSave
} from "./model.js";
import { ensureBreaksForDate } from "./breaks.js";
import { bindEvents } from "./events.js";
import { refresh, undoLastAction, redoLastAction } from "./actions.js";
import { initializeHistoryUi } from "./history-ui.js";
import { initializePaintInput } from "./paint-input.js";
import { initializeStorageSafetyUi } from "./storage-safety-ui.js";
import { elements, setSaveStatus } from "./elements.js";
import { render } from "./render.js";
import { consumeWorkspaceMigrationFlag } from "./workspace-normalizer.js";
import { requireSimpleAuthentication, showAuthenticatedApplication } from "./auth-ui.js";
import { showFatalStorageLoadError } from "./fatal-storage-ui.js";

function loadStylesheet(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = href;
  document.head.append(stylesheet);
}

function bindSaveFlushHandlers() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPendingSave().catch(() => {});
  });
  globalThis.addEventListener("pagehide", () => {
    void flushPendingSave().catch(() => {});
  });
}

async function initialize() {
  loadStylesheet("./print-page.css");
  loadStylesheet("./paint.css");
  loadStylesheet("./enhancements.css?v=20260711b");
  setStatusHandler(setSaveStatus);

  let hadSavedState;
  try {
    hadSavedState = await loadSavedState();
  } catch (error) {
    console.error(error);
    setSaveStatus(`読込失敗: ${error.message}`, true);
    showAuthenticatedApplication();
    showFatalStorageLoadError(error);
    return false;
  }

  initializeHistoryUi({ onUndo: undoLastAction, onRedo: redoLastAction });
  initializePaintInput({
    tableContainer: elements.tableContainer,
    onStrokeComplete: refresh,
    setStatus: setSaveStatus
  });
  bindEvents();
  bindSaveFlushHandlers();

  const shiftCatalogMigrated = consumeWorkspaceMigrationFlag();
  ensureBreaksForDate(state.selectedDate);
  if (shiftCatalogMigrated) {
    scheduleSave();
    setSaveStatus("旧シフト区分を整理し、公休を「休」へ統一しました");
  } else if (workspaceState.migratedLegacyState) {
    setSaveStatus("既存データを「無題のシフト表」へ移行しました");
  } else {
    setSaveStatus(hadSavedState ? "保存データを読み込みました" : "新しいシフト表を開始しました");
  }

  initializeStorageSafetyUi();
  render(elements);
  document.documentElement.dataset.appReady = "1";
  return true;
}

await requireSimpleAuthentication();
const initialized = await initialize();
if (initialized) showAuthenticatedApplication();
