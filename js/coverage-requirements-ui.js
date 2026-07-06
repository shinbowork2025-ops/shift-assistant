import { getCoverageRequirements } from "./model.js";
import { EMPLOYMENT_TYPES } from "./employment-types.js";
import { REQUIREMENT_SCOPES, REQUIREMENT_SCOPE_LABELS } from "./coverage-requirements.js";
import { saveCoverageRequirements } from "./actions/coverage-requirement-actions.js";

let controls = null;
let setStatus = () => {};

function labeledControl(labelText, control) {
  const label = document.createElement("label");
  label.className = "coverage-req-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

function numberInput(value) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = "99";
  input.step = "1";
  input.inputMode = "numeric";
  input.className = "coverage-req-number";
  input.value = String(value ?? 0);
  return input;
}

function createRow(requirement = {}) {
  const row = document.createElement("div");
  row.className = "coverage-req-row";

  const scope = document.createElement("select");
  for (const value of REQUIREMENT_SCOPES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = REQUIREMENT_SCOPE_LABELS[value];
    scope.append(option);
  }
  scope.value = REQUIREMENT_SCOPES.includes(requirement.scope) ? requirement.scope : "everyday";

  const start = document.createElement("input");
  start.type = "time";
  start.className = "coverage-req-time";
  start.value = requirement.start ?? "09:00";

  const end = document.createElement("input");
  end.type = "time";
  end.className = "coverage-req-time";
  end.value = requirement.end ?? "17:00";

  const total = numberInput(requirement.requiredTotal ?? 1);

  const typeInputs = new Map();
  const typeFields = EMPLOYMENT_TYPES.map((type) => {
    const input = numberInput(requirement.requiredByType?.[type.code] ?? 0);
    typeInputs.set(type.code, input);
    return labeledControl(type.shortLabel, input);
  });

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "button danger-ghost compact coverage-req-remove";
  removeButton.textContent = "削除";
  removeButton.addEventListener("click", () => {
    row.remove();
    updateEmptyHint();
  });

  row.append(
    labeledControl("曜日", scope),
    labeledControl("開始", start),
    labeledControl("終了", end),
    labeledControl("合計", total),
    ...typeFields,
    removeButton
  );
  row._readRequirement = () => ({
    scope: scope.value,
    start: start.value,
    end: end.value,
    requiredTotal: Number(total.value) || 0,
    requiredByType: Object.fromEntries(
      [...typeInputs.entries()].map(([code, input]) => [code, Number(input.value) || 0])
    )
  });
  return row;
}

function updateEmptyHint() {
  if (!controls) return;
  const hasRows = controls.list.querySelector(".coverage-req-row");
  controls.emptyHint.hidden = Boolean(hasRows);
}

function collectRequirements() {
  return [...controls.list.querySelectorAll(".coverage-req-row")]
    .map((row) => row._readRequirement())
    .filter((requirement) => {
      const hasTimes = requirement.start && requirement.end && requirement.start < requirement.end;
      const wantsPeople = requirement.requiredTotal > 0
        || Object.values(requirement.requiredByType).some((count) => count > 0);
      return hasTimes && wantsPeople;
    });
}

function populateRows() {
  const requirements = getCoverageRequirements();
  const fragment = document.createDocumentFragment();
  for (const requirement of requirements) fragment.append(createRow(requirement));
  controls.list.replaceChildren(fragment);
  updateEmptyHint();
}

function createDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "coverage-req-dialog";
  const form = document.createElement("form");
  form.method = "dialog";

  const header = document.createElement("div");
  header.className = "dialog-header";
  const title = document.createElement("h2");
  title.textContent = "必要人数を設定";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "icon-button";
  closeButton.setAttribute("aria-label", "閉じる");
  closeButton.textContent = "×";
  header.append(title, closeButton);

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = "時間帯ごとに必要な合計人数と、雇用区分（社=社員・準=準社員・パ=パート/アルバイト）ごとの最小人数を設定します。1日チャートで不足する時間帯を赤く表示します。";

  const list = document.createElement("div");
  list.className = "coverage-req-list";

  const emptyHint = document.createElement("p");
  emptyHint.className = "coverage-req-empty muted";
  emptyHint.textContent = "まだ設定がありません。「時間帯を追加」から登録してください。";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "button secondary";
  addButton.textContent = "＋ 時間帯を追加";
  addButton.addEventListener("click", () => {
    controls.list.append(createRow());
    updateEmptyHint();
  });

  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "button secondary";
  cancelButton.textContent = "キャンセル";
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "button primary";
  saveButton.textContent = "保存";
  actions.append(spacer, cancelButton, saveButton);

  form.append(header, note, list, emptyHint, addButton, actions);
  dialog.append(form);
  document.body.append(dialog);

  closeButton.addEventListener("click", () => dialog.close());
  cancelButton.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const requirements = collectRequirements();
    saveCoverageRequirements(requirements);
    dialog.close();
    setStatus(requirements.length
      ? `必要人数を${requirements.length}件設定しました`
      : "必要人数の設定をクリアしました");
  });

  return { dialog, list, emptyHint };
}

export function initializeCoverageRequirementUi(options = {}) {
  setStatus = options.setStatus ?? setStatus;
  if (!controls) controls = createDialog();
  return controls;
}

export function openCoverageRequirementDialog(options = {}) {
  initializeCoverageRequirementUi(options);
  populateRows();
  controls.dialog.showModal();
}
