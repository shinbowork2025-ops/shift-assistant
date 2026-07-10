import { state, getCoverageRequirements } from "./model.js";
import { EMPLOYMENT_TYPES } from "./employment-types.js";
import { REQUIREMENT_SCOPES, REQUIREMENT_SCOPE_LABELS } from "./coverage-requirements.js";
import { saveStaffingSettings } from "./actions/coverage-requirement-actions.js";
import {
  parseStaffingSettingsCsv,
  buildStaffingSettingsCsv,
  SAMPLE_STAFFING_SETTINGS_CSV
} from "./staffing-settings-csv.js";
import { downloadFile } from "./files.js";

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

function textInput(value, placeholder) {
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 40;
  input.value = value ?? "";
  input.placeholder = placeholder;
  return input;
}

function createRequirementRow(requirement = {}) {
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
  const department = textInput(requirement.requiredDepartment, "例：園芸");
  const departmentCount = numberInput(requirement.requiredDepartmentCount ?? 0);
  const qualification = textInput(requirement.requiredQualification, "例：危険物取扱者");
  const qualificationCount = numberInput(requirement.requiredQualificationCount ?? 0);
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "button danger-ghost compact coverage-req-remove";
  removeButton.textContent = "削除";
  removeButton.addEventListener("click", () => {
    row.remove();
    updateEmptyHint();
  });
  row.append(
    labeledControl("曜日", scope), labeledControl("開始", start), labeledControl("終了", end),
    labeledControl("合計", total), ...typeFields,
    labeledControl("必要部門", department), labeledControl("部門人数", departmentCount),
    labeledControl("必要資格", qualification), labeledControl("資格者人数", qualificationCount), removeButton
  );
  row._readRequirement = () => ({
    scope: scope.value,
    start: start.value,
    end: end.value,
    requiredTotal: Number(total.value) || 0,
    requiredByType: Object.fromEntries([...typeInputs.entries()].map(([code, input]) => [code, Number(input.value) || 0])),
    requiredDepartment: department.value.trim(),
    requiredDepartmentCount: Number(departmentCount.value) || 0,
    requiredQualification: qualification.value.trim(),
    requiredQualificationCount: Number(qualificationCount.value) || 0
  });
  return row;
}

function createQualificationRow(employee) {
  const row = document.createElement("label");
  row.className = "qualification-edit-row";
  const name = document.createElement("span");
  name.textContent = [employee.name, employee.code, employee.department].filter(Boolean).join(" / ");
  const input = textInput((employee.qualifications ?? []).join(";"), "複数は ; で区切る");
  input.dataset.employeeId = employee.id;
  row.append(name, input);
  return row;
}

function updateEmptyHint() {
  if (!controls) return;
  controls.emptyHint.hidden = Boolean(controls.list.querySelector(".coverage-req-row"));
}

function collectRequirements() {
  const requirements = [];
  const errors = [];
  [...controls.list.querySelectorAll(".coverage-req-row")].forEach((row, index) => {
    const requirement = row._readRequirement();
    const wantsPeople = requirement.requiredTotal > 0
      || Object.values(requirement.requiredByType).some((count) => count > 0)
      || requirement.requiredDepartmentCount > 0
      || requirement.requiredQualificationCount > 0;
    if (!wantsPeople) return;
    if (!requirement.start || !requirement.end || requirement.start >= requirement.end) {
      errors.push(`${index + 1}件目の開始・終了時刻を確認してください。`);
    }
    if (requirement.requiredDepartmentCount > 0 && !requirement.requiredDepartment) {
      errors.push(`${index + 1}件目は部門名を入力してください。`);
    }
    if (requirement.requiredQualificationCount > 0 && !requirement.requiredQualification) {
      errors.push(`${index + 1}件目は資格名を入力してください。`);
    }
    requirements.push(requirement);
  });
  return { requirements, errors };
}

function collectQualificationUpdates() {
  return [...controls.qualifications.querySelectorAll("input[data-employee-id]")].map((input) => ({
    employeeId: input.dataset.employeeId,
    qualifications: input.value.split(/[、,;\n]/).map((item) => item.trim()).filter(Boolean)
  }));
}

function populateRequirements(requirements) {
  const fragment = document.createDocumentFragment();
  for (const requirement of requirements) fragment.append(createRequirementRow(requirement));
  controls.list.replaceChildren(fragment);
  updateEmptyHint();
}

function populateQualificationRows() {
  const fragment = document.createDocumentFragment();
  for (const employee of state.employees) fragment.append(createQualificationRow(employee));
  controls.qualifications.replaceChildren(fragment);
}

function applyQualificationUpdates(updates) {
  for (const update of updates) {
    const input = controls.qualifications.querySelector(`input[data-employee-id="${CSS.escape(update.employeeId)}"]`);
    if (input) input.value = update.qualifications.join(";");
  }
}

async function importCsvFile(file) {
  const result = parseStaffingSettingsCsv(await file.text(), state.employees);
  populateRequirements(result.requirements);
  applyQualificationUpdates(result.qualificationUpdates);
  setStatus(
    result.errors.length
      ? `CSVを読み込みましたが${result.errors.length}行を確認してください: ${result.errors.slice(0, 2).join(" / ")}`
      : `CSVから必要人数${result.requirements.length}件・資格${result.qualificationUpdates.length}名分を読み込みました`,
    result.errors.length > 0
  );
}

function exportCurrentCsv(sample = false) {
  const { requirements } = collectRequirements();
  const employeeCopies = state.employees.map((employee) => {
    const input = controls.qualifications.querySelector(`input[data-employee-id="${CSS.escape(employee.id)}"]`);
    return {
      ...employee,
      qualifications: input ? input.value.split(/[、,;\n]/).map((item) => item.trim()).filter(Boolean) : []
    };
  });
  downloadFile(
    sample ? "配置条件-見本.csv" : "配置条件.csv",
    sample ? SAMPLE_STAFFING_SETTINGS_CSV : buildStaffingSettingsCsv({ employees: employeeCopies, requirements }),
    "text/csv;charset=utf-8"
  );
}

function createDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "coverage-req-dialog staffing-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const header = document.createElement("div");
  header.className = "dialog-header";
  const title = document.createElement("h2");
  title.textContent = "必要人数・部門・資格を設定";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "icon-button";
  closeButton.setAttribute("aria-label", "閉じる");
  closeButton.textContent = "×";
  header.append(title, closeButton);
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = "時間帯ごとに合計・雇用区分・必要部門・必要資格を設定できます。同じ時間帯に複数条件を追加できます。";
  const csvActions = document.createElement("div");
  csvActions.className = "staffing-csv-actions";
  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.className = "button secondary";
  importButton.textContent = "配置条件CSVを読込";
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "button secondary";
  exportButton.textContent = "現在値をCSV保存";
  const sampleButton = document.createElement("button");
  sampleButton.type = "button";
  sampleButton.className = "button secondary";
  sampleButton.textContent = "CSV見本";
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = ".csv,text/csv";
  importInput.hidden = true;
  csvActions.append(importButton, exportButton, sampleButton, importInput);
  const reqHeading = document.createElement("h3");
  reqHeading.textContent = "時間帯別の配置条件";
  const list = document.createElement("div");
  list.className = "coverage-req-list";
  const emptyHint = document.createElement("p");
  emptyHint.className = "coverage-req-empty muted";
  emptyHint.textContent = "まだ設定がありません。";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "button secondary";
  addButton.textContent = "＋ 時間帯を追加";
  const qualHeading = document.createElement("h3");
  qualHeading.textContent = "従業員の保有資格";
  const qualificationNote = document.createElement("p");
  qualificationNote.className = "muted";
  qualificationNote.textContent = "複数の資格はセミコロン（;）または読点で区切ります。";
  const qualifications = document.createElement("div");
  qualifications.className = "qualification-edit-list";
  const validation = document.createElement("p");
  validation.className = "staffing-validation";
  validation.setAttribute("role", "alert");
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
  form.append(header, note, csvActions, reqHeading, list, emptyHint, addButton, qualHeading, qualificationNote, qualifications, validation, actions);
  dialog.append(form);
  document.body.append(dialog);
  closeButton.addEventListener("click", () => dialog.close());
  cancelButton.addEventListener("click", () => dialog.close());
  addButton.addEventListener("click", () => {
    list.append(createRequirementRow());
    updateEmptyHint();
  });
  importButton.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const [file] = importInput.files ?? [];
    if (!file) return;
    try { await importCsvFile(file); } catch (error) { setStatus(`CSV読込失敗: ${error.message}`, true); }
    importInput.value = "";
  });
  exportButton.addEventListener("click", () => exportCurrentCsv(false));
  sampleButton.addEventListener("click", () => exportCurrentCsv(true));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const { requirements, errors } = collectRequirements();
    if (errors.length) {
      validation.textContent = errors.join("\n");
      setStatus(`配置条件を保存できません: ${errors[0]}`, true);
      return;
    }
    validation.textContent = "";
    const qualificationUpdates = collectQualificationUpdates();
    saveStaffingSettings({ requirements, qualificationUpdates });
    dialog.close();
    setStatus(`配置条件${requirements.length}件と資格情報を保存しました`);
  });
  return { dialog, list, emptyHint, qualifications, validation, importInput };
}

export function initializeCoverageRequirementUi(options = {}) {
  setStatus = options.setStatus ?? setStatus;
  if (!controls) controls = createDialog();
  return controls;
}

export function openCoverageRequirementDialog(options = {}) {
  initializeCoverageRequirementUi(options);
  populateRequirements(getCoverageRequirements());
  populateQualificationRows();
  controls.validation.textContent = "";
  controls.dialog.showModal();
}
