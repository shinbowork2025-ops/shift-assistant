import {
  state,
  dateDisplayName,
  minutesToTime,
  scheduleSave,
  setBreaksForDate
} from "./model.js";
import {
  addGreedyInitialSolution,
  buildOptimizerInput,
  formatOptimizerOutput
} from "./optimizer-data.js";
import { runWithHistory } from "./history.js";
import { setSaveStatus } from "./elements.js";
import { refresh } from "./actions/view-actions.js";

let ui = null;
let activeWorker = null;
let proposal = null;

function loadStylesheet() {
  if (document.querySelector('link[href="./rest-assistant.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./rest-assistant.css";
  document.head.append(link);
}

function stopWorker() {
  activeWorker?.terminate();
  activeWorker = null;
}

function scoreRow(label, before, after) {
  const row = document.createElement("tr");
  const title = document.createElement("th");
  title.scope = "row";
  title.textContent = label;
  const beforeCell = document.createElement("td");
  beforeCell.textContent = String(before ?? 0);
  const afterCell = document.createElement("td");
  afterCell.textContent = String(after ?? 0);
  row.append(title, beforeCell, afterCell);
  return row;
}

function renderProposal(result, dayPlan) {
  const improvement = result.initialScore - result.score;
  ui.status.className = "rest-proposal-status success";
  ui.status.textContent = `最適化完了：${result.elapsedMs.toFixed(1)}ms、${result.iterations}周、改善${improvement}`;

  const table = document.createElement("table");
  table.className = "rest-score-table";
  const header = document.createElement("tr");
  ["評価項目", "初期案", "最適化後"].forEach((text) => {
    const cell = document.createElement("th");
    cell.textContent = text;
    header.append(cell);
  });
  const head = document.createElement("thead");
  head.append(header);
  const body = document.createElement("tbody");
  body.append(
    scoreRow("合計スコア", result.initialScore, result.score),
    scoreRow("必要人数不足", result.initialBreakdown?.understaffing, result.breakdown?.understaffing),
    scoreRow("同時休憩", result.initialBreakdown?.concurrentBreaks, result.breakdown?.concurrentBreaks),
    scoreRow("目標時刻との差", result.initialBreakdown?.targetDeviation, result.breakdown?.targetDeviation)
  );
  table.append(head, body);

  const list = document.createElement("div");
  list.className = "rest-proposal-list";
  for (const employee of dayPlan.employees) {
    const row = document.createElement("div");
    row.className = "rest-proposal-row";
    const name = document.createElement("strong");
    name.textContent = employee.name;
    const times = document.createElement("span");
    times.textContent = (result.breaks[employee.id] ?? [])
      .map((item) => `${minutesToTime(item.start)}〜${minutesToTime(item.end)}${item.locked ? " 🔒" : ""}`)
      .join(" / ") || "休憩なし";
    row.append(name, times);
    list.append(row);
  }

  ui.result.replaceChildren(table, list);
  ui.applyButton.disabled = false;
}

function setError(message) {
  ui.status.className = "rest-proposal-status error";
  ui.status.textContent = message;
  ui.result.replaceChildren();
  ui.applyButton.disabled = true;
}

function createUi() {
  loadStylesheet();
  const dialog = document.createElement("dialog");
  dialog.className = "rest-proposal-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const header = document.createElement("div");
  header.className = "dialog-header";
  const title = document.createElement("h2");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-button";
  close.setAttribute("aria-label", "閉じる");
  close.textContent = "×";
  header.append(title, close);

  const note = document.createElement("p");
  note.className = "rest-proposal-note";
  note.textContent = "初期案を作成してから、固定済み休憩を動かさずに同時休憩と人員不足が減る配置を探索します。この画面で確認し、『適用』を押すまで保存されません。";
  const status = document.createElement("p");
  status.className = "rest-proposal-status";
  status.setAttribute("aria-live", "polite");
  const result = document.createElement("div");
  result.className = "rest-proposal-result";

  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button secondary";
  cancel.textContent = "キャンセル";
  const applyButton = document.createElement("button");
  applyButton.type = "submit";
  applyButton.className = "button primary";
  applyButton.textContent = "この休憩案を適用";
  applyButton.disabled = true;
  actions.append(spacer, cancel, applyButton);

  form.append(header, note, status, result, actions);
  dialog.append(form);
  document.body.append(dialog);
  ui = { dialog, form, title, status, result, applyButton };

  const closeDialog = () => {
    stopWorker();
    proposal = null;
    dialog.close();
  };
  close.addEventListener("click", closeDialog);
  cancel.addEventListener("click", closeDialog);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!proposal) return;
    const stored = formatOptimizerOutput(proposal.result.breaks);
    runWithHistory(`${dateDisplayName(proposal.dateValue)}の休憩案を適用`, () => {
      setBreaksForDate(proposal.dateValue, stored, { save: false });
      scheduleSave();
    });
    const improvement = proposal.result.initialScore - proposal.result.score;
    closeDialog();
    refresh();
    setSaveStatus(`休憩案を適用しました（スコア改善 ${improvement}）`);
  });
  return ui;
}

function optimizeInWorker(dayPlan, config) {
  return new Promise((resolve, reject) => {
    stopWorker();
    activeWorker = new Worker(new URL("./optimizerWorker.js", import.meta.url), { type: "module" });
    activeWorker.addEventListener("message", (event) => {
      const message = event.data;
      stopWorker();
      if (message?.ok) resolve(message.result);
      else reject(new Error(message?.error || "休憩案の作成に失敗しました。"));
    }, { once: true });
    activeWorker.addEventListener("error", (event) => {
      stopWorker();
      reject(new Error(event.message || "最適化Workerを起動できませんでした。"));
    }, { once: true });
    activeWorker.postMessage({ dayPlan, config });
  });
}

export async function openRestProposal() {
  createUi();
  proposal = null;
  ui.applyButton.disabled = true;
  ui.result.replaceChildren();
  ui.title.textContent = `${dateDisplayName(state.selectedDate)}の休憩案`;
  ui.status.className = "rest-proposal-status working";
  ui.status.textContent = "初期案を生成し、休憩配置を最適化しています…";
  ui.dialog.showModal();

  const input = buildOptimizerInput({
    dateValue: state.selectedDate,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    breaks: state.breaks
  });
  if (!input.employees.length) {
    setError("この日に勤務する従業員がいません。");
    return;
  }
  const dayPlan = addGreedyInitialSolution(input);
  try {
    const result = await optimizeInWorker(dayPlan, {
      seed: state.selectedDate,
      restarts: 3,
      edgeBufferMinutes: 60,
      minimumBreakGapMinutes: 60
    });
    if (!result.hardCheck?.ok) throw new Error(result.hardCheck?.issues?.join("、") || "制約違反を検出しました。");
    proposal = { dateValue: state.selectedDate, result };
    renderProposal(result, dayPlan);
  } catch (error) {
    console.error(error);
    setError(error.message);
  }
}
