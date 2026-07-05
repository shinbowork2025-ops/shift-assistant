import { getDaysInMonth, getDayInfo, monthDisplayName, state } from "./model.js";
import { isDayOffRequestedInData, requestedDaysForEmployee } from "./day-off-requests.js";
import {
  applyMonthScheduleProposal,
  createCurrentInitialMonthPlan,
  saveEmployeeDayOffRequests
} from "./month-schedule-actions.js";

let controls = null;
let worker = null;
let currentResult = null;
let setStatus = () => {};

function loadStylesheet() {
  if (document.querySelector('link[href="./month-schedule.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./month-schedule.css";
  document.head.append(link);
}

function button(text, className = "button secondary") {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  return element;
}

function labelControl(text, control) {
  const label = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = text;
  label.append(span, control);
  return label;
}

function selectedValues(inputs) {
  return inputs.filter((input) => input.checked).map((input) => input.value);
}

function createCheckList(className) {
  const list = document.createElement("div");
  list.className = className;
  return list;
}

function createRequestDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "day-off-request-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const header = document.createElement("div");
  header.className = "dialog-header";
  const title = document.createElement("h2");
  title.textContent = "希望休を設定";
  const close = button("×", "icon-button");
  close.setAttribute("aria-label", "閉じる");
  header.append(title, close);

  const employeeSelect = document.createElement("select");
  const employeeLabel = labelControl("従業員", employeeSelect);
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = "希望休は探索時に公休で固定されます。入力済み勤務と重なる場合は探索を開始せず、競合として知らせます。";
  const days = createCheckList("day-off-request-grid");
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const cancel = button("キャンセル");
  const save = button("希望休を保存", "button primary");
  save.type = "submit";
  actions.append(spacer, cancel, save);
  form.append(header, employeeLabel, note, days, actions);
  dialog.append(form);
  document.body.append(dialog);

  close.addEventListener("click", () => dialog.close());
  cancel.addEventListener("click", () => dialog.close());
  employeeSelect.addEventListener("change", () => renderRequestDays({ employeeSelect, days }));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const employeeId = employeeSelect.value;
    const requestedDays = [...days.querySelectorAll('input[type="checkbox"]:checked')].map((input) => Number(input.value));
    const count = saveEmployeeDayOffRequests(employeeId, requestedDays);
    setStatus(`${monthDisplayName(state.selectedMonth)}の希望休を${count}日保存しました`);
    dialog.close();
    syncRequestMarkers();
  });
  return { dialog, employeeSelect, days };
}

function populateRequestEmployees() {
  const select = controls.request.employeeSelect;
  const previous = select.value;
  const fragment = document.createDocumentFragment();
  for (const employee of state.employees) {
    const option = document.createElement("option");
    option.value = employee.id;
    option.textContent = employee.name;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  if (state.employees.some((employee) => employee.id === previous)) select.value = previous;
  renderRequestDays(controls.request);
}

function renderRequestDays(requestControls) {
  const employeeId = requestControls.employeeSelect.value;
  const requested = new Set(requestedDaysForEmployee(state.dayOffRequests ?? {}, state.selectedMonth, employeeId));
  const fragment = document.createDocumentFragment();
  for (let day = 1; day <= getDaysInMonth(state.selectedMonth); day += 1) {
    const info = getDayInfo(state.selectedMonth, day);
    const label = document.createElement("label");
    label.className = `day-request-item weekday-${info.weekday}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(day);
    input.checked = requested.has(info.dateValue);
    const text = document.createElement("span");
    text.textContent = `${day}（${info.label}）`;
    label.append(input, text);
    fragment.append(label);
  }
  requestControls.days.replaceChildren(fragment);
}

function openRequestDialog() {
  populateRequestEmployees();
  controls.request.dialog.showModal();
}

function createSearchDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "month-search-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const header = document.createElement("div");
  header.className = "dialog-header";
  const title = document.createElement("h2");
  title.textContent = "月間シフト案を探索";
  const close = button("×", "icon-button");
  close.setAttribute("aria-label", "閉じる");
  header.append(title, close);

  const monthText = document.createElement("strong");
  monthText.className = "month-search-target";

  const employees = document.createElement("fieldset");
  const employeeLegend = document.createElement("legend");
  employeeLegend.textContent = "対象従業員";
  const employeeTools = document.createElement("div");
  employeeTools.className = "compact-button-row";
  const allEmployees = button("全員");
  const noEmployees = button("全解除");
  employeeTools.append(allEmployees, noEmployees);
  const employeeList = createCheckList("month-search-check-list");
  employees.append(employeeLegend, employeeTools, employeeList);

  const shifts = document.createElement("fieldset");
  const shiftLegend = document.createElement("legend");
  shiftLegend.textContent = "使用する勤務シフト";
  const shiftTools = document.createElement("div");
  shiftTools.className = "compact-button-row";
  const allShifts = button("全て");
  const noShifts = button("全解除");
  shiftTools.append(allShifts, noShifts);
  const shiftList = createCheckList("month-search-check-list shift-list");
  shifts.append(shiftLegend, shiftTools, shiftList);

  const settings = document.createElement("div");
  settings.className = "month-search-settings";
  const seed = document.createElement("input");
  seed.type = "number";
  seed.value = "1";
  seed.step = "1";
  const iterations = document.createElement("input");
  iterations.type = "number";
  iterations.value = "12000";
  iterations.min = "100";
  iterations.max = "100000";
  iterations.step = "100";
  settings.append(labelControl("案番号（シード）", seed), labelControl("探索回数", iterations));

  const requestButton = button("希望休を設定");
  const note = document.createElement("p");
  note.className = "month-search-note";
  note.textContent = "入力済みセル・ロック済みセル・希望休は固定します。探索結果はプレビューだけで、適用するまで保存されません。";

  const progressWrap = document.createElement("div");
  progressWrap.className = "month-search-progress";
  progressWrap.hidden = true;
  const progress = document.createElement("progress");
  progress.max = 1;
  progress.value = 0;
  const progressText = document.createElement("span");
  progressWrap.append(progress, progressText);

  const result = document.createElement("div");
  result.className = "month-search-result";
  result.setAttribute("aria-live", "polite");

  const actions = document.createElement("div");
  actions.className = "dialog-actions month-search-actions";
  const start = button("案を作成", "button primary");
  const stop = button("中断して現在の案を表示", "button secondary");
  stop.hidden = true;
  const another = button("別の案", "button secondary");
  another.hidden = true;
  const apply = button("この案を適用", "button primary");
  apply.hidden = true;
  const cancel = button("閉じる", "button secondary");
  actions.append(start, stop, another, apply, cancel);
  form.append(header, monthText, requestButton, employees, shifts, settings, note, progressWrap, result, actions);
  dialog.append(form);
  document.body.append(dialog);

  const searchControls = {
    dialog,
    monthText,
    employeeList,
    employeeInputs: [],
    shiftList,
    shiftInputs: [],
    seed,
    iterations,
    requestButton,
    progressWrap,
    progress,
    progressText,
    result,
    start,
    stop,
    another,
    apply,
    cancel
  };

  allEmployees.addEventListener("click", () => searchControls.employeeInputs.forEach((input) => { input.checked = true; }));
  noEmployees.addEventListener("click", () => searchControls.employeeInputs.forEach((input) => { input.checked = false; }));
  allShifts.addEventListener("click", () => searchControls.shiftInputs.forEach((input) => { input.checked = true; }));
  noShifts.addEventListener("click", () => searchControls.shiftInputs.forEach((input) => { input.checked = false; }));
  requestButton.addEventListener("click", openRequestDialog);
  start.addEventListener("click", () => startSearch(false));
  stop.addEventListener("click", stopSearch);
  another.addEventListener("click", () => {
    searchControls.seed.value = String((Number(searchControls.seed.value) || 0) + 1);
    startSearch(true);
  });
  apply.addEventListener("click", applyProposal);
  close.addEventListener("click", closeSearchDialog);
  cancel.addEventListener("click", closeSearchDialog);
  dialog.addEventListener("close", clearGridPreview);
  return searchControls;
}

function populateSearchLists() {
  const employeeFragment = document.createDocumentFragment();
  controls.search.employeeInputs = [];
  for (const employee of state.employees) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = employee.id;
    input.checked = true;
    label.append(input, document.createTextNode(employee.name));
    employeeFragment.append(label);
    controls.search.employeeInputs.push(input);
  }
  controls.search.employeeList.replaceChildren(employeeFragment);

  const shiftFragment = document.createDocumentFragment();
  controls.search.shiftInputs = [];
  for (const shiftType of state.shiftTypes.filter((item) => item.isWork)) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = shiftType.code;
    input.checked = true;
    label.append(input, document.createTextNode(`${shiftType.code} ${shiftType.start}〜${shiftType.end}`));
    shiftFragment.append(label);
    controls.search.shiftInputs.push(input);
  }
  controls.search.shiftList.replaceChildren(shiftFragment);
}

function createMainControls() {
  const area = document.querySelector("#monthPanel .month-generation-actions");
  const clearButton = document.getElementById("clearMonthButton");
  if (!area) return null;
  const open = button("月間案を探索", "button primary");
  if (clearButton) area.insertBefore(open, clearButton);
  else area.append(open);
  const panel = document.createElement("section");
  panel.className = "month-search-summary";
  panel.hidden = true;
  const slot = document.getElementById("monthResultsSlot");
  slot?.append(panel);
  open.addEventListener("click", openSearchDialog);
  return { open, panel };
}

function openSearchDialog() {
  clearGridPreview();
  currentResult = null;
  populateSearchLists();
  controls.search.monthText.textContent = `${monthDisplayName(state.selectedMonth)}の未固定セルを探索します`;
  controls.search.result.textContent = "希望休と入力済みセルを確認してから案を作成してください。";
  controls.search.start.hidden = false;
  controls.search.stop.hidden = true;
  controls.search.another.hidden = true;
  controls.search.apply.hidden = true;
  controls.search.progressWrap.hidden = true;
  controls.search.dialog.showModal();
}

function selectedConfig() {
  const selectedEmployeeIds = selectedValues(controls.search.employeeInputs);
  const selectedWorkShiftCodes = selectedValues(controls.search.shiftInputs);
  if (!selectedEmployeeIds.length) throw new Error("対象従業員を1人以上選択してください。");
  if (!selectedWorkShiftCodes.length) throw new Error("勤務シフトを1種類以上選択してください。");
  return {
    selectedEmployeeIds,
    selectedWorkShiftCodes,
    seed: Number(controls.search.seed.value) || 1,
    iterations: Math.max(100, Number(controls.search.iterations.value) || 12000)
  };
}

function stopWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function startSearch(isAlternative) {
  try {
    stopWorker();
    clearGridPreview();
    currentResult = null;
    const config = selectedConfig();
    const plan = createCurrentInitialMonthPlan(config);
    worker = new Worker(new URL("./month-search-worker.js", import.meta.url), { type: "module" });
    controls.search.start.hidden = true;
    controls.search.another.hidden = true;
    controls.search.apply.hidden = true;
    controls.search.stop.hidden = false;
    controls.search.progressWrap.hidden = false;
    controls.search.progress.value = 0;
    controls.search.result.textContent = isAlternative ? "別の案を探索しています…" : "初期案を作成し、全体スコアを改善しています…";

    worker.onmessage = (event) => handleWorkerMessage(event.data);
    worker.onerror = (event) => finishWithError(event.message || "探索Workerでエラーが発生しました。");
    worker.postMessage({
      type: "start",
      plan,
      config: { seed: config.seed, iterations: config.iterations }
    });
  } catch (error) {
    finishWithError(error.message);
  }
}

function stopSearch() {
  if (!worker) return;
  controls.search.stop.disabled = true;
  controls.search.progressText.textContent = "中断要求を処理しています…";
  worker.postMessage({ type: "stop" });
}

function handleWorkerMessage(message) {
  if (message.type === "progress") {
    const progress = message.progress;
    controls.search.progress.value = progress.iterations ? progress.iteration / progress.iterations : 0;
    controls.search.progressText.textContent = `${progress.iteration.toLocaleString()} / ${progress.iterations.toLocaleString()}　最良 ${Math.round(progress.bestScore).toLocaleString()}`;
    return;
  }
  if (message.type === "error") {
    finishWithError(message.message);
    return;
  }
  if (message.type === "result") finishWithResult(message.result);
}

function finishWithError(message) {
  stopWorker();
  controls.search.stop.disabled = false;
  controls.search.start.hidden = false;
  controls.search.stop.hidden = true;
  controls.search.progressWrap.hidden = true;
  controls.search.result.textContent = message;
  controls.search.result.classList.add("error");
}

function scoreLine(label, value) {
  const row = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = label;
  const span = document.createElement("span");
  span.textContent = Math.round(Number(value) || 0).toLocaleString();
  row.append(strong, span);
  return row;
}

function finishWithResult(result) {
  stopWorker();
  currentResult = result;
  controls.search.stop.disabled = false;
  controls.search.stop.hidden = true;
  controls.search.start.hidden = true;
  controls.search.another.hidden = false;
  controls.search.apply.hidden = !result.hardCheck?.ok;
  controls.search.progress.value = 1;
  controls.search.progressText.textContent = result.stopped ? "中断時点の最良案" : "探索完了";
  controls.search.result.classList.remove("error");

  const heading = document.createElement("strong");
  heading.textContent = result.hardCheck?.ok ? "有効なシフト案を作成しました" : "ハード制約違反があります";
  const comparison = document.createElement("p");
  comparison.textContent = `スコア ${Math.round(result.initialScore).toLocaleString()} → ${Math.round(result.score).toLocaleString()}、採用率 ${(result.acceptanceRate * 100).toFixed(1)}%、${result.iterations.toLocaleString()}反復`;
  const breakdown = document.createElement("div");
  breakdown.className = "month-score-breakdown";
  breakdown.append(
    scoreLine("日別配置", result.breakdown?.daily),
    scoreLine("勤務日数・連勤・残業", result.breakdown?.employee),
    scoreLine("土日・遅い勤務の公平性", result.breakdown?.fairness)
  );
  const warnings = document.createElement("ul");
  for (const issue of result.hardCheck?.issues ?? []) {
    const item = document.createElement("li");
    item.textContent = issue;
    warnings.append(item);
  }
  controls.search.result.replaceChildren(heading, comparison, breakdown, warnings);
  previewPlan(result.plan);
}

function previewPlan(plan) {
  clearGridPreview();
  for (const employeeId of plan.selectedEmployeeIds) {
    for (let day = 1; day <= plan.daysInMonth; day += 1) {
      const cell = document.querySelector(`.paint-cell[data-employee-id="${CSS.escape(employeeId)}"][data-day="${day}"]`);
      const select = cell?.querySelector(".shift-select");
      if (!cell || !select) continue;
      const proposed = plan.assignments?.[employeeId]?.[day] ?? "";
      const original = select.value;
      if (proposed === original) continue;
      cell.classList.add("month-proposal-changed");
      cell.dataset.proposalBefore = original;
      cell.dataset.proposalAfter = proposed;
      select.value = proposed;
      select.dataset.proposalPreview = "true";
    }
  }
}

function clearGridPreview() {
  document.querySelectorAll(".month-proposal-changed").forEach((cell) => {
    const select = cell.querySelector(".shift-select");
    if (select && select.dataset.proposalPreview === "true") {
      select.value = cell.dataset.proposalBefore ?? "";
      delete select.dataset.proposalPreview;
    }
    cell.classList.remove("month-proposal-changed");
    delete cell.dataset.proposalBefore;
    delete cell.dataset.proposalAfter;
  });
}

function applyProposal() {
  if (!currentResult) return;
  try {
    clearGridPreview();
    const applied = applyMonthScheduleProposal(currentResult);
    controls.search.dialog.close();
    controls.main.panel.hidden = false;
    controls.main.panel.textContent = `${monthDisplayName(state.selectedMonth)}へ${applied.applied}セルを適用しました。ロック再確認によるスキップは${applied.skippedLocked}セルです。`;
    setStatus(`月間シフト案を${applied.applied}セルへ適用しました`);
    currentResult = null;
  } catch (error) {
    finishWithError(error.message);
  }
}

function closeSearchDialog() {
  stopWorker();
  clearGridPreview();
  controls.search.dialog.close();
}

function syncRequestMarkers() {
  if (!controls) return;
  document.querySelectorAll(".paint-cell").forEach((cell) => {
    const employeeId = cell.dataset.employeeId;
    const day = Number(cell.dataset.day);
    const requested = isDayOffRequestedInData(
      state.dayOffRequests ?? {},
      state.selectedMonth,
      employeeId,
      `${state.selectedMonth}-${String(day).padStart(2, "0")}`
    );
    let marker = cell.querySelector(".day-off-request-marker");
    if (requested && !marker) {
      marker = document.createElement("span");
      marker.className = "day-off-request-marker";
      marker.textContent = "希";
      marker.title = "希望休";
      cell.append(marker);
    } else if (!requested && marker) {
      marker.remove();
    }
  });
}

function syncMainButton() {
  if (!controls) return;
  controls.main.open.disabled = state.employees.length === 0 || !state.shiftTypes.some((shiftType) => shiftType.isWork);
  syncRequestMarkers();
}

export function initializeMonthScheduleUi(options = {}) {
  if (controls) return controls;
  loadStylesheet();
  setStatus = options.setStatus ?? setStatus;
  const main = createMainControls();
  if (!main) return null;
  controls = { main, search: createSearchDialog(), request: createRequestDialog() };
  const table = document.getElementById("tableContainer");
  if (table) new MutationObserver(syncMainButton).observe(table, { childList: true, subtree: true });
  syncMainButton();
  return controls;
}
