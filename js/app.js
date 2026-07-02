import { state, workspaceState, loadSavedState, setStatusHandler } from "./model.js";
import { ensureBreaksForDate } from "./breaks.js";
import { bindEvents } from "./events.js";
import { undoLastAction, redoLastAction } from "./actions.js";
import { initializeHistoryUi } from "./history-ui.js";
import { elements, setSaveStatus } from "./elements.js";
import { render } from "./render.js";

function loadStylesheet(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = href;
  document.head.append(stylesheet);
}

async function initialize() {
  loadStylesheet("./print-page.css");
  loadStylesheet("./history.css");
  setStatusHandler(setSaveStatus);
  initializeHistoryUi({ onUndo: undoLastAction, onRedo: redoLastAction });
  bindEvents();
  try {
    const hadSavedState = await loadSavedState();
    ensureBreaksForDate(state.selectedDate);
    if (workspaceState.migratedLegacyState) {
      setSaveStatus("既存データを「無題のシフト表」へ移行しました");
    } else {
      setSaveStatus(hadSavedState ? "保存データを読み込みました" : "新しいシフト表を開始しました");
    }
  } catch (error) {
    console.error(error);
    setSaveStatus(`読込失敗: ${error.message}`, true);
  }
  render(elements);
}

initialize();
