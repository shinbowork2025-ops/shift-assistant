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
import { initializeMonthSolverUi } from "./month-solver-ui.js";
import { elements, setSaveStatus } from "./elements.js";
import { render } from "./render.js";
import { consumeWorkspaceMigrationFlag } from "./workspace-normalizer.js";

function loadStylesheet(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = href;
  document.head.append(stylesheet);
}

async function initialize() {
  loadStylesheet("./print-page.css");
  loadStylesheet("./paint.css");
  loadStylesheet("./month-solver.css");
  setStatusHandler(setSaveStatus);
  initializeHistoryUi({ onUndo: undoLastAction, onRedo: redoLastAction });
  initializePaintInput({
    tableContainer: elements.tableContainer,
    onStrokeComplete: refresh,
    setStatus: setSaveStatus
  });
  bindEvents();
  // デバウンス待ちの変更をタブ切替・クローズ時に取りこぼさない。
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPendingSave().catch(() => {});
  });
  globalThis.addEventListener("pagehide", () => {
    void flushPendingSave().catch(() => {});
  });
  try {
    const hadSavedState = await loadSavedState();
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
  } catch (error) {
    console.error(error);
    setSaveStatus(`読込失敗: ${error.message}`, true);
  }
  render(elements);
  initializeMonthSolverUi({ setStatus: setSaveStatus });
  // boot-guard.jsが監視する初期化完了フラグ。モジュール読込が失敗して
  // ここへ到達しない場合、ガードが再読み込みの案内を表示する。
  document.documentElement.dataset.appReady = "1";
}

initialize();
