import { getScheduleRevision, monthDisplayName, state } from "./model.js";
import { createCurrentMonthSolverPlan, applyMonthSolverResult } from "./month-solver-actions.js";
import { validateMonthSolverApplication } from "./month-solver-application.js";
import { EPOCH_ITERATIONS } from "./month-solver-control.js";
import { createSolverInputFingerprint } from "./month-solver-worker-protocol.js";

const PRECISION_TIME_LIMIT_MS = 3 * 60 * 1000;
const PRECISION_ITERATIONS_PER_RESTART = 12000;

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

function durationText(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function ensureStylesheet() {
  if (document.querySelector('link[href="./month-solver.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./month-solver.css";
  document.head.append(link);
}

function syncModeControls(controls) {
  const precision = controls.mode.value === "precision";
  controls.iterationsLabel.hidden = precision;
  controls.modeNote.hidden = !precision;
  controls.start.textContent = precision ? "3分間の精密最適化を開始" : "案を作成";
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
  const mode = document.createElement("select");
  const fastOption = document.createElement("option");
  fastOption.value = "fast";
  fastOption.textContent = "高速最適化（探索回数指定）";
  const precisionOption = document.createElement("option");
  precisionOption.value = "precision";
  precisionOption.textContent = "精密最適化（最大3分）";
  mode.append(fastOption, precisionOption);
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
  const iterationsLabel = labeled("探索回数", iterations);
  settings.append(labeled("探索モード", mode), labeled("案番号（シード）", seed), iterationsLabel);

  const modeNote = document.createElement("p");
  modeNote.className = "month-solver-mode-note";
  modeNote.textContent = "最大3分間、異なるシードで探索を繰り返し、その時間内に見つかった候補のうち最良案を採用候補として表示します。全体最適解である保証はありません。実行中でも中断できます。";
  modeNote.hidden = true;

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

  form.append(header, target, explanation, fieldset, settings, modeNote, progressArea, result, actions);
  dialog.append(form);
  document.body.append(dialog);

  const controls = {
    dialog, target, shiftList, shiftInputs: [], mode, seed, iterations, iterationsLabel, modeNote,
    progressArea, progress, progressText, result, start, stop, another, apply, cancel
  };
  allShifts.addEventListener("click", () => controls.shiftInputs.forEach((input) => { input.checked = true; }));
  noShifts.addEventListener("click", () => controls.shiftInputs.forEach((input) => { input.checked = false; }));
  mode.addEventListener("change", () => syncModeControls(controls));
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
  syncModeControls(controls);
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
  syncModeControls(ui.dialog);
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
    mode: ui.dialog.mode.value === "precision" ? "precision" : "fast",
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
    const precision = options.mode === "precision";
    const plan = createCurrentMonthSolverPlan(options);
    const scheduleRevision = getScheduleRevision();
    const inputFingerprint = createSolverInputFingerprint(plan);
    worker = new Worker(new URL("./month-solver-worker.js", import.meta.url), { type: "module" });
    ui.dialog.start.hidden = true;
    ui.dialog.stop.hidden = false;
    ui.dialog.stop.disabled = false;
    ui.dialog.another.hidden = true;
    ui.dialog.apply.hidden = true;
    ui.dialog.progressArea.hidden = false;
    ui.dialog.progress.value = 0;
    ui.dialog.progressText.textContent = precision ? "0:00 / 3:00" : "0 / 0";
    ui.dialog.result.classList.remove("error");
    if (precision) {
      ui.dialog.result.textContent = alternative
        ? "別シードで精密最適化を実行しています。最大3分間探索します…"
        : "複数の独立探索を繰り返し、3分以内に見つかった最良案を探しています…";
    } else {
      ui.dialog.result.textContent = alternative ? "別シードで探索しています…" : "初期案を作成し、月全体を改善しています…";
    }
    worker.onmessage = (event) => handleWorkerMessage(event.data);
    worker.onerror = (event) => showError(event.message || "月間ソルバーでエラーが発生しました。");
    worker.postMessage({
      type: "start",
      scheduleRevision,
      inputFingerprint,
      planSnapshot: plan,
      masterSeed: options.seed,
      mode: options.mode,
      timeBudgetMs: precision ? PRECISION_TIME_LIMIT_MS : undefined,
      fixedBlockCount: precision ? undefined : Math.max(1, Math.ceil(options.iterations / EPOCH_ITERATIONS)),
      solverConfig: precision
        ? {
            mode: "precision",
            iterationsPerRestart: PRECISION_ITERATIONS_PER_RESTART
          }
        : { mode: "fast" }
    });
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
    const progress = message.progress ?? message;
    if (progress.mode === "precision") {
      ui.dialog.progress.value = progress.timeLimitMs
        ? Math.min(1, progress.elapsedMs / progress.timeLimitMs)
        : 0;
      ui.dialog.progressText.textContent = `${durationText(progress.elapsedMs)} / ${durationText(progress.timeLimitMs)}　独立探索${progress.restart}回目・合計${progress.iteration.toLocaleString()}反復　${objectiveText(progress.bestObjective)}`;
    } else {
      ui.dialog.progress.value = progress.iterations ? progress.iteration / progress.iterations : 0;
      ui.dialog.progressText.textContent = `${progress.iteration.toLocaleString()} / ${progress.iterations.toLocaleString()}　${objectiveText(progress.bestObjective)}`;
    }
    return;
  }
  if (message.type === "error") {
    showError(message.message);
    return;
  }
  if (message.type === "result") {
    showResult({
      ...message.result,
      scheduleRevision: message.scheduleRevision,
      inputFingerprint: message.inputFingerprint,
      shiftChanges: message.shiftChanges,
      breakChanges: message.breakChanges,
      manualBreakLockChanges: message.manualBreakLockChanges,
      resultSummary: message.resultSummary,
      estimateMetrics: message.estimateMetrics,
      statistics: message.statistics,
      solverConfigSnapshot: message.solverConfigSnapshot
    });
  }
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

function planChanges(plan) {
  const selected = new Set(plan.selectedEmployeeIds);
  const changes = [];
  for (const employee of plan.employees) {
    if (!selected.has(employee.id)) continue;
    for (let day = 1; day <= plan.daysInMonth; day += 1) {
      const before = plan.originalAssignments?.[employee.id]?.[day] ?? "";
      const after = plan.assignments?.[employee.id]?.[day] ?? "";
      if (before === after) continue;
      changes.push({ employeeName: employee.name, day, before, after });
    }
  }
  return changes;
}

function changePreviewList(changes) {
  const list = document.createElement("ul");
  list.className = "month-solver-change-list";
  for (const change of changes.slice(0, 8)) {
    const item = document.createElement("li");
    item.textContent = `${change.employeeName}・${change.day}日：${change.before || "空欄"} → ${change.after || "空欄"}`;
    list.append(item);
  }
  if (changes.length > 8) {
    const item = document.createElement("li");
    item.textContent = `ほか${changes.length - 8}セル`;
    list.append(item);
  }
  return list;
}

function shortageReportSection(reports) {
  if (!Array.isArray(reports) || reports.length === 0) return null;
  const details = document.createElement("details");
  details.className = "month-solver-shortage-reports";
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = `残っている不足の内訳（${reports.length}日）`;
  const list = document.createElement("ul");
  for (const report of reports.slice(0, 10)) {
    const item = document.createElement("li");
    const messages = Array.isArray(report.messages) && report.messages.length
      ? report.messages.join(" / ")
      : `${report.shortagePeople}人枠不足・${report.shortageSlots}スロット`;
    item.textContent = `${report.day}日：${messages}`;
    list.append(item);
  }
  if (reports.length > 10) {
    const item = document.createElement("li");
    item.textContent = `ほか${reports.length - 10}日`;
    list.append(item);
  }
  details.append(summary, list);
  return details;
}

function showResult(result) {
  stopWorker();
  currentResult = result;
  const applicationValidation = validateMonthSolverApplication(result);
  const precision = result.mode === "precision";
  ui.dialog.stop.hidden = true;
  ui.dialog.stop.disabled = false;
  ui.dialog.another.hidden = false;
  ui.dialog.another.textContent = precision ? "別シードでもう一度3分探索" : "別の案";
  ui.dialog.apply.hidden = !applicationValidation.ok;
  ui.dialog.progress.value = precision && result.stopped
    ? Math.min(1, result.elapsedMs / result.timeLimitMs)
    : 1;
  ui.dialog.progressText.textContent = precision
    ? result.stopped
      ? "中断時点で見つかった最良案"
      : "3分間の精密最適化が完了"
    : result.stopped
      ? "中断時点の最良案"
      : "探索完了";
  ui.dialog.result.classList.remove("error");

  const title = document.createElement("strong");
  if (!applicationValidation.ok) {
    title.textContent = "適用条件を満たしていません";
  } else if (result.classification === "repairable") {
    title.textContent = "要修正の月間案を作成しました";
  } else {
    title.textContent = precision ? "精密最適化で有効な最良案を見つけました" : "有効な月間案を作成しました";
  }
  const finalShortage = Number(result.finalShortagePersonSlots ?? result.objective.shortagePeople) || 0;
  const stats = document.createElement("div");
  stats.className = "month-solver-metrics";
  stats.append(
    metricRow("必要人数不足", `${result.initialObjective.shortagePeople}人枠`, `${finalShortage}人枠`),
    metricRow("勤務間隔・連勤違反", result.initialObjective.hard, result.objective.hard),
    metricRow("固定残業枠超過", `${Math.round(result.initialObjective.overtime / 6) / 10}時間`, `${Math.round(result.objective.overtime / 6) / 10}時間`),
    metricRow("公平性スコア", Math.round(result.initialObjective.fairness), Math.round(result.objective.fairness)),
    metricRow("優先・既存傾向", Math.round(result.initialObjective.preference), Math.round(result.objective.preference))
  );
  const changes = planChanges(result.plan);
  const details = document.createElement("p");
  details.textContent = precision
    ? `探索時間${durationText(result.elapsedMs)}、${result.restarts.toLocaleString()}回の独立探索、合計${result.iterations.toLocaleString()}反復を実行しました。その時間内に見つかった候補のうち最良の案です。全体最適解である保証はありません。${changes.length}セルを変更候補にしています。`
    : `${result.iterations.toLocaleString()}反復、候補採用率${(result.acceptanceRate * 100).toFixed(1)}%。${changes.length}セルを変更候補にしています。`;
  const changeList = changePreviewList(changes);
  const shortageSection = shortageReportSection(result.shortageReports);
  const issues = document.createElement("ul");
  for (const issue of applicationValidation.issues) {
    const item = document.createElement("li");
    item.textContent = issue;
    issues.append(item);
  }
  const statutoryCount = Number(result.objective.statutoryViolationCount) || 0;
  const statutoryConfirmation = statutoryCount > 0 ? document.createElement("label") : null;
  if (statutoryConfirmation) {
    statutoryConfirmation.className = "month-solver-statutory-confirmation";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.statutoryConfirm = "true";
    statutoryConfirmation.append(checkbox, document.createTextNode("設定された法定ルールの違反を確認しました"));
    ui.dialog.apply.hidden = true;
    checkbox.addEventListener("change", () => {
      ui.dialog.apply.hidden = !applicationValidation.ok || !checkbox.checked;
    });
  }
  ui.dialog.result.replaceChildren(
    title,
    stats,
    details,
    changeList,
    ...(shortageSection ? [shortageSection] : []),
    ...(statutoryConfirmation ? [statutoryConfirmation] : []),
    issues
  );
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
    ui.summary.textContent = `${monthDisplayName(state.selectedMonth)}へシフト${summary.applied}セル・休憩${summary.appliedBreaks}件を一括適用しました。`;
    setStatus(`月間ソルバーの案をシフト${summary.applied}セル・休憩${summary.appliedBreaks}件へ適用しました`);
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
