import {
  getMonthEditMode,
  setMonthEditMode,
  subscribeMonthEditMode
} from "./month-edit-mode.js";

const MODES = [
  { value: "normal", label: "通常入力", description: "プルダウンで1セルずつ入力します。" },
  { value: "shift-paint", label: "シフト入力", description: "選んだシフトをクリックまたはドラッグで連続入力します。" },
  { value: "lock-paint", label: "セルロック", description: "自動作成で変更しないセルをロックまたは解除します。" },
  { value: "off-request-paint", label: "希望休", description: "希望休の登録または解除を行います。" }
];

let controls = null;

function syncPanels(mode) {
  const visibility = new Map([
    [".paint-panel", mode === "shift-paint"],
    [".lock-panel", mode === "lock-paint"],
    [".off-request-panel", mode === "off-request-paint"]
  ]);
  for (const [selector, visible] of visibility) {
    const panel = document.querySelector(selector);
    if (panel) panel.hidden = !visible;
  }
}

function sync(mode = getMonthEditMode()) {
  if (!controls) return;
  for (const button of controls.buttons) {
    const active = button.dataset.mode === mode;
    button.classList.toggle("primary", active);
    button.classList.toggle("secondary", !active);
    button.setAttribute("aria-pressed", String(active));
  }
  const selected = MODES.find((item) => item.value === mode) ?? MODES[0];
  controls.status.textContent = `${selected.label}：${selected.description}`;
  syncPanels(mode);
}

export function initializeMonthEditToolbar() {
  if (controls) return controls;
  const slot = document.querySelector("#monthToolsSlot");
  if (!slot) return null;

  const panel = document.createElement("section");
  panel.className = "month-edit-toolbar";
  panel.setAttribute("aria-label", "月間表の編集モード");
  const heading = document.createElement("div");
  heading.className = "month-edit-toolbar-heading";
  const title = document.createElement("strong");
  title.textContent = "編集モード";
  const status = document.createElement("p");
  status.className = "month-edit-toolbar-status";
  status.setAttribute("role", "status");
  heading.append(title, status);

  const actions = document.createElement("div");
  actions.className = "month-edit-toolbar-actions";
  const buttons = MODES.map((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button secondary";
    button.dataset.mode = mode.value;
    button.textContent = mode.label;
    button.addEventListener("click", () => setMonthEditMode(mode.value));
    actions.append(button);
    return button;
  });

  const note = document.createElement("small");
  note.className = "month-edit-toolbar-note";
  note.textContent = "Escキーで通常入力へ戻ります。";
  panel.append(heading, actions, note);
  slot.prepend(panel);

  controls = { panel, status, buttons };
  subscribeMonthEditMode(sync);
  globalThis.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (document.querySelector("dialog[open]")) return;
    if (getMonthEditMode() !== "normal") setMonthEditMode("normal");
  });
  sync();
  return controls;
}
