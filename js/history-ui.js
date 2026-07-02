import { getHistoryStatus, subscribeHistory } from "./history.js";

let controls = null;

function isTextEditingTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("[contenteditable='true']")) return true;
  const input = target.closest("input, textarea");
  if (!input) return false;
  const type = String(input.getAttribute("type") || "text").toLowerCase();
  return !["button", "checkbox", "radio", "submit", "reset", "file", "color", "range"].includes(type);
}

function updateControls(status = getHistoryStatus()) {
  if (!controls) return;
  controls.undoButton.disabled = !status.canUndo;
  controls.redoButton.disabled = !status.canRedo;
  controls.undoButton.title = status.canUndo ? `${status.undoLabel}を元に戻す` : "元に戻せる操作はありません";
  controls.redoButton.title = status.canRedo ? `${status.redoLabel}をやり直す` : "やり直せる操作はありません";
  controls.status.textContent = status.canUndo
    ? `次に元へ戻せる操作：${status.undoLabel}（${status.undoCount}件）`
    : "このシフト表には、このセッションで元へ戻せる操作がありません。";
}

export function initializeHistoryUi({ onUndo, onRedo }) {
  const panel = document.createElement("section");
  panel.className = "history-panel panel";
  panel.setAttribute("aria-label", "操作履歴");

  const textArea = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = "操作履歴";
  const status = document.createElement("p");
  status.className = "history-status";
  textArea.append(heading, status);

  const actions = document.createElement("div");
  actions.className = "history-actions";
  const undoButton = document.createElement("button");
  undoButton.id = "undoButton";
  undoButton.className = "button secondary";
  undoButton.type = "button";
  undoButton.textContent = "↶ 元に戻す";
  undoButton.setAttribute("aria-keyshortcuts", "Control+Z Meta+Z");
  const redoButton = document.createElement("button");
  redoButton.id = "redoButton";
  redoButton.className = "button secondary";
  redoButton.type = "button";
  redoButton.textContent = "↷ やり直す";
  redoButton.setAttribute("aria-keyshortcuts", "Control+Y Meta+Shift+Z");
  const note = document.createElement("span");
  note.className = "history-note";
  note.textContent = "履歴はブラウザを閉じるまで・各シフト表50件";
  actions.append(undoButton, redoButton, note);
  panel.append(textArea, actions);

  const workspacePanel = document.querySelector(".workspace-panel");
  workspacePanel?.insertAdjacentElement("afterend", panel);
  controls = { panel, status, undoButton, redoButton };

  undoButton.addEventListener("click", onUndo);
  redoButton.addEventListener("click", onRedo);

  document.addEventListener("keydown", (event) => {
    if (event.repeat || event.altKey || isTextEditingTarget(event.target)) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) onRedo();
      else onUndo();
    } else if (key === "y" && !event.shiftKey) {
      event.preventDefault();
      onRedo();
    }
  });

  subscribeHistory(updateControls);
  updateControls();
}
