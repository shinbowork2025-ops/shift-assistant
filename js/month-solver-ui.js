import { monthDisplayName, state } from "./model.js";
import { createCurrentMonthSolverPlan, applyMonthSolverResult } from "./month-solver-actions.js";

let ui = null;
let worker = null;
let currentResult = null;
let setStatus = () => {};

function createButton(text, className = "button secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function labeled(text, control) {
  const label = document.createElement("label");
  const title = document.createElement("span");
  title.textContent = text;
  label.append(title, control);
  return label;
}

function selectedValues(inputs) {
  return inputs.filter((input) => input.checked).map((input) => input.value);
}

function ensureStylesheet() {
  if (document.querySelector('link[href="./month-solver.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./month-solver.css";
  document.head.append(link);
}

function createDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "month-solver-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const header = document.createElement("div");
  header.className = "dialog-header";
  const title = document.createElement("h2");
  title.textContent = "月間シフト全体を改善";
  const close = createButton("×", "icon-button");
  close.setAttribute("aria-label", "閉じる");
  header.append(title, close);

  const target = document.createElement("strong");
  target.className = "month-solver-target";
  const explanation = document.createElement("p");
  explanation.className = "month-solver-note";
  explanation.textContent = "必要人数の不足を最優先に、勤務間隔・連勤、残業枠、公平性、優先シフトの順で月全体を反復改善します。ロック済みセルと有休などの休日区分は変更しません。";

  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "使用する勤務シフト";
  const shiftTools = document.createElement("div");
  shiftTools.className = "compact-button-row";
  const allShifts = createButton("全て選択");
  const noShifts = createButton("全解除");
  shiftTools.append(allShifts, noShifts);
  const shiftList = document.createElement("div");
  shiftList.className = "month-solver-shifts";
  fieldset.append(legend, shiftTools, shiftList);

  const settings = document.createElement("div");
  settings.className = "month-solver-settings";
  const seed = document.createElement("input");
  seed.type = "number";
  seed.step = "1";
  seed.value = "1";
  const iterations = document.createElement("input");
  iterations.type = "number";
  iterations.min = "500";
  iterations.max = "50000";
  iterations.step = "500";
  iterations.value = "8000";
  settings.append(labeled("案番号（シード）", seed), labeled("探索回数", iterations));

  const progressArea = document.createElement("div");
  progressArea.className = "month-solver-progress";
  progressArea.hidden = true;
  const progress = document.createElement("progress");
  progress.max = 1;
  progress.value = 0;
  const progressText = document.createElement("span");
  progressArea.append(progress, progressText);

  const result = document.createElement("div");
  result.className = "month-solver-result";
  result.setAttribute("aria-live", "polite");
  result.textContent = "案を作成すると、現在の表との差分を紫枠でプレビューします。";

  const actions = document.createElement("div");
  actions.className = "dialog-actions month-solver-actions";
  const start = createButton("案を作成", "button primary");
  const stop = createButton("中断して最良案を表示");
  stop.hidden = true;
  const another = createButton("別の案");
  another.hidden = true;
  const apply = createButton("この案を適用", "button primary");
  apply.hidden = true;
  const cancel = createButton("閉じる");
  actions.append(start, stop, another, apply, cancel);

  form.append(header, target, explanation, fieldset, settings, progressArea, result, actions);
  dialog.append(form);
  document.body.append(dialog);

  const controls = {
    dialog, target, shiftList, shiftInputs: [], seed, iterations,
    progressArea, progress, progressText, result, start, stop, another, apply, cancel
  };
  allShifts.addEventListener("click", () => controls.shiftInputs.forEach((input) => { input.checked = true; }));
  noShifts.addEventListener("click", () => controls.shiftInputs.forEach((input) => { input.checked = false; }));
  close.addEventListener("click", closeDialog);
  cancel.addEventListener("click", closeDialog);
  start.addEventListener("click", () => startSearch(false));
  stop.addEventListener("click", stopSearch);
  another.addEventListener("click", () => {
    controls.seed.value = String((Number(controls.seed.value) || 0) + 1);
    startSearch(true);
  });
  apply.addEventListener("click", applyResult);
  dialog.addEventListener("close", clearPreview);
  return controls;
}

function populateShifts() {
  const fragment = document.createDocumentFragment();
  ui.dialog.shiftInputs = [];
  for (const shiftType of state.shiftTypes.filter((item) => item.isWork && item.start && item.end)) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = shiftType.code;
    input.checked = true;
    label.append(input, document.createTextNode(`${shiftType.code}　${shiftType.start}〜${shiftType.end}`));
    fragment.append(label);
    ui.dialog.shiftInputs.push(input);
  }
  ui.dialog.shiftList.replaceChildren(fragment);
}

function stopWorker() {
  if (!worker) return;
  worker.terminate();
  worker = null;
}

function openDialog() {
  stopWorker();
  clearPreview();
  currentResult = null;
  populateShifts();
  ui.dialog.target.textContent = `${monthDisplayName(state.selectedMonth)}・${state.employees.length}人を対象にします`;
  ui.dialog.result.textContent = state.coverageRequirements?.length
    ? "必要人数設定を最優先条件として案を作成します。"
    : "必要人数設定がないため、勤務間隔・残業・公平性を中心に改善します。";
  ui.dialog.result.classList.remove("error");
  ui.dialog.start.hidden = false;
  ui.dialog.stop.hidden = true;
  ui.dialog.another.hidden = true;
  ui.dialog.apply.hidden = true;
  ui.dialog.progressArea.hidden = true;
  ui.dialog.dialog.showModal();
}

function closeDialog() {
  stopWorker();
  clearPreview();
  ui.dialog.dialog.close();
}

function searchOptions() {
  const selectedShiftCodes = selectedValues(ui.dialog.shiftInputs);
  if (!selectedShiftCodes.length) throw new Error("勤務シフトを1種類以上選択してください。");
  return {
    selectedShiftCodes,
    seed: Number(ui.dialog.seed.value) || 1,
    iterations: Math.max(500, Number(ui.dialog.iterations.value) || 8000)
  };
}

function startSearch(alternative) {
  try {
    stopWorker();
    clearPreview();
    currentResult = null;
    const options = searchOptions();
    const plan = createCurrentMonthSolverPlan(options);
    worker = new Worker(new URL("./month-solver-worker.js", import.meta.url), { type: "module" });
    ui.dialog.start.hidden = true;
    ui.dialog.stop.hidden = false;
    ui.dialog.stop.disabled = false;
    ui.dialog.another.hidden = true;
    ui.dialog.apply.hidden = true;
    ui.dialog.progressArea.hidden = false;
    ui.dialog.progress.value = 0;
    ui.dialog.result.classList.remove("error");
    ui.dialog.result.textContent = alternative ? "別シードで探索しています…" : "初期案を作成し、月全体を改善しています…";
    worker.onmessage = (event) => handleWorkerMessage(event.data);
    worker.onerror = (event) => showError(event.message || "月間ソルバーでエラーが発生しました。");
    worker.postMessage({ type: "start", plan, config: { seed: options.seed, iterations: options.iterations } });
  } catch (error) {
    showError(error.message);
  }
}

function stopSearch() {
  if (!worker) return;
  ui.dialog.stop.disabled = true;
  ui.dialog.progressText.textContent = "中断要求を処理しています…";
  worker.postMessage({ type: "stop" });
}

function objectiveText(objective) {
  return `不足 ${objective.shortagePeople}人枠 / 違反 ${objective.hard} / 残業超過 ${Math.round(objective.overtime / 6) / 10}時間 / 公平性 ${Math.round(objective.fairness)}`;
}

function handleWorkerMessage(message) {
  if (message.type === "progress") {
    const progress = message.progress;
    ui.dialog.progress.value = progress.iterations ? progress.iteration / progress.iterations : 0;
    ui.dialog.progressText.textContent = `${progress.iteration.toLocaleString()} / ${progress.iterations.toLocaleString()}　${objectiveText(progress.bestObjective)}`;
    return;
  }
  if (message.type === "error") {
    showError(message.message);
    return;
  }
  if (message.type === "result") showResult(message.result);
}

function showError(message) {
  stopWorker();
  ui.dialog.stop.hidden = true;
  ui.dialog.stop.disabled = false;
  ui.dialog.start.hidden = false;
  ui.dialog.progressArea.hidden = true;
  ui.dialog.result.classList.add("error");
  ui.dialog.result.textContent = message;
}

function metricRow(label, before, after) {
  const row = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = label;
  const value = document.createElement("span");
  value.textContent = `${before} → ${after}`;
  row.append(name, value);
  return row;
}

function showResult(result) {
  stopWorker();
  currentResult = result;
  ui.dialog.stop.hidden = true;
  ui.dialog.stop.disabled = false;
  ui.dialog.another.hidden = false;
  ui.dialog.apply.hidden = !result.validation?.ok;
  ui.dialog.progress.value = 1;
  ui.dialog.progressText.textContent = result.stopped ? "中断時点の最良案" : "探索完了";
  ui.dialog.result.classList.remove("error");

  const title = document.createElement("strong");
  title.textContent = result.validation?.ok ? "有効な月間案を作成しました" : "固定条件に矛盾があります";
  const stats = document.createElement("div");
  stats.className = "month-solver-metrics";
  stats.append(
    metricRow("必要人数不足", `${result.initialObjective.shortagePeople}人枠`, `${result.objective.shortagePeople}人枠`),
    metricRow("勤務間隔・連勤違反", result.initialObjective.hard, result.objective.hard),
    metricRow("固定残業枠超過", `${Math.round(result.initialObjective.overtime / 6) / 10}時間`, `${Math.round(result.objective.overtime / 6) / 10}時間`),
    metricRow("公平性スコア", Math.round(result.initialObjective.fairness), Math.round(result.objective.fairness)),
    metricRow("優先・既存傾向", Math.round(result.initialObjective.preference), Math.round(result.objective.preference))
  );
  const details = document.createElement("p");
  details.textContent = `${result.iterations.toLocaleString()}反復、候補採用率${(result.acceptanceRate * 100).toFixed(1)}%。紫枠が現在の表から変わるセルです。`;
  const issues = document.createElement("ul");
  if (result.objective.shortagePeople > 0) {
    const item = document.createElement("li");
    item.textContent = `必要人数不足が${result.objective.shortagePeople}人枠残っています。1日チャートで不足時間帯を確認してください。`;
    issues.append(item);
  }
  if (result.objective.hard > 0) {
    const item = document.createElement("li");
    item.textContent = `勤務間隔・連勤違反が${result.objective.hard}残っています。ソルバーは初期案より違反を増やしていません。`;
    issues.append(item);
  }
  for (const issue of result.validation?.issues ?? []) {
    const item = document.createElement("li");
    item.textContent = issue;
    issues.append(item);
  }
  ui.dialog.result.replaceChildren(title, stats, details, issues);
  previewPlan(result.plan);
}

function findCell(employeeId, day) {
  return [...document.querySelectorAll(".paint-cell")].find((cell) => (
    cell.dataset.employeeId === employeeId && Number(cell.dataset.day) === day
  ));
}

function previewPlan(plan) {
  clearPreview();
  for (const employeeId of plan.selectedEmployeeIds) {
    for (let day = 1; day <= plan.daysInMonth; day += 1) {
      const cell = findCell(employeeId, day);
      const select = cell?.querySelector(".shift-select");
      if (!cell || !select) continue;
      const after = plan.assignments?.[employeeId]?.[day] ?? "";
      if (select.value === after) continue;
      cell.classList.add("month-solver-preview");
      cell.dataset.solverBefore = select.value;
      select.value = after;
      select.dataset.solverPreview = "true";
    }
  }
}

function clearPreview() {
  document.querySelectorAll(".month-solver-preview").forEach((cell) => {
    const select = cell.querySelector(".shift-select");
    if (select?.dataset.solverPreview === "true") {
      select.value = cell.dataset.solverBefore ?? "";
      delete select.dataset.solverPreview;
    }
    cell.classList.remove("month-solver-preview");
    delete cell.dataset.solverBefore;
  });
}

function applyResult() {
  if (!currentResult) return;
  try {
    clearPreview();
    const summary = applyMonthSolverResult(currentResult);
    ui.dialog.dialog.close();
    ui.summary.hidden = false;
    ui.summary.textContent = `${monthDisplayName(state.selectedMonth)}へ${summary.applied}セルを適用し、${summary.changedDates}日分の休憩を再配置しました。`;
    setStatus(`月間ソルバーの案を${summary.applied}セルへ適用しました`);
    currentResult = null;
  } catch (error) {
    showError(error.message);
  }
}

function syncButton() {
  if (!ui) return;
  ui.open.disabled = state.employees.length === 0 || !state.shiftTypes.some((item) => item.isWork);
}

export function initializeMonthSolverUi(options = {}) {
  if (ui) return ui;
  ensureStylesheet();
  setStatus = options.setStatus ?? setStatus;
  const actionArea = document.querySelector("#monthPanel .month-generation-actions");
  const clearButton = document.getElementById("clearMonthButton");
  if (!actionArea) return null;
  const open = createButton("月間ソルバー", "button primary");
  if (clearButton) actionArea.insertBefore(open, clearButton);
  else actionArea.append(open);
  const summary = document.createElement("section");
  summary.className = "month-solver-summary";
  summary.hidden = true;
  document.getElementById("monthResultsSlot")?.append(summary);
  ui = { open, summary, dialog: createDialog() };
  open.addEventListener("click", openDialog);
  const table = document.getElementById("tableContainer");
  if (table) new MutationObserver(syncButton).observe(table, { childList: true, subtree: true });
  syncButton();
  return ui;
}
