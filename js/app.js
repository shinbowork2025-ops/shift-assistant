import { state, loadSavedState, setStatusHandler } from "./model.js";
import { ensureBreaksForDate } from "./breaks.js";
import { bindEvents } from "./events.js";
import { elements, setSaveStatus } from "./elements.js";
import { render } from "./render.js";

async function initialize() {
  setStatusHandler(setSaveStatus);
  bindEvents();
  try {
    const hadSavedState = await loadSavedState();
    ensureBreaksForDate(state.selectedDate);
    setSaveStatus(hadSavedState ? "保存データを読み込みました" : "新しいデータを開始しました");
  } catch (error) {
    console.error(error);
    setSaveStatus(`読込失敗: ${error.message}`, true);
  }
  render(elements);
}

initialize();
