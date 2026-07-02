import { state, workspaceState, loadSavedState, setStatusHandler } from "./model.js";
import { ensureBreaksForDate } from "./breaks.js";
import { bindEvents } from "./events.js";
import { elements, setSaveStatus } from "./elements.js";
import { render } from "./render.js";

function loadPrintPageFix() {
  if (document.querySelector('link[href="./print-page.css"]')) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "./print-page.css";
  document.head.append(stylesheet);
}

async function initialize() {
  loadPrintPageFix();
  setStatusHandler(setSaveStatus);
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
