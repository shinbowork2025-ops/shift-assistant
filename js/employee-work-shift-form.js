import { state } from "./model.js";
import {
  availableWorkShiftCodes,
  normalizeAllowedShiftCodes,
  normalizeAvoidLateEarly,
  normalizePreferredShiftCode
} from "./work-shift-preferences.js";

let controls = null;

function workShiftTypes() {
  return state.shiftTypes.filter((shiftType) => shiftType.isWork);
}

function createLabeledControl(labelText, control, noteText = "") {
  const label = document.createElement("label");
  const title = document.createElement("span");
  title.textContent = labelText;
  label.append(title, control);
  if (noteText) {
    const note = document.createElement("small");
    note.className = "form-note";
    note.textContent = noteText;
    label.append(note);
  }
  return label;
}

function renderShiftChecks(employee) {
  const shifts = workShiftTypes();
  const allowed = new Set(availableWorkShiftCodes(employee, shifts));
  const fragment = document.createDocumentFragment();
  controls.shiftInputs = [];

  for (const shiftType of shifts) {
    const label = document.createElement("label");
    label.className = "work-shift-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "employeeAllowedShift";
    input.value = shiftType.code;
    input.checked = allowed.has(shiftType.code);
    const text = document.createElement("span");
    text.textContent = `${shiftType.code} ${shiftType.name}`;
    if (shiftType.start && shiftType.end) text.title = `${shiftType.start}〜${shiftType.end}`;
    label.append(input, text);
    fragment.append(label);
    controls.shiftInputs.push(input);
  }
  controls.shiftList.replaceChildren(fragment);
}

function renderPreferredOptions(employee) {
  const shifts = workShiftTypes();
  const previous = normalizePreferredShiftCode(employee?.preferredShiftCode);
  const fragment = document.createDocumentFragment();
  const automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "自動（既存傾向と配置バランスを優先）";
  fragment.append(automatic);
  for (const shiftType of shifts) {
    const option = document.createElement("option");
    option.value = shiftType.code;
    option.textContent = `${shiftType.code} ${shiftType.name}`;
    fragment.append(option);
  }
  controls.preferred.replaceChildren(fragment);
  controls.preferred.value = shifts.some((item) => item.code === previous) ? previous : "";
}

function syncPreferredAvailability() {
  if (!controls) return;
  const checked = new Set(controls.shiftInputs.filter((input) => input.checked).map((input) => input.value));
  const allSelected = controls.shiftInputs.length > 0 && checked.size === controls.shiftInputs.length;
  for (const option of controls.preferred.options) {
    option.disabled = option.value !== "" && !allSelected && !checked.has(option.value);
  }
  if (controls.preferred.value && !allSelected && !checked.has(controls.preferred.value)) {
    controls.preferred.value = "";
  }
  controls.selectedCount.textContent = controls.shiftInputs.length
    ? `${checked.size}/${controls.shiftInputs.length}種類を許可`
    : "勤務シフトがありません";
}

export function initializeEmployeeWorkShiftForm() {
  if (controls) return controls;
  const form = document.getElementById("employeeForm");
  const actions = form?.querySelector(".dialog-actions");
  if (!form || !actions) return null;

  const section = document.createElement("fieldset");
  section.className = "employee-work-shift-settings";
  const legend = document.createElement("legend");
  legend.textContent = "勤務シフトの自動割当設定";

  const preferred = document.createElement("select");
  preferred.id = "employeePreferredShiftInput";

  const toolbar = document.createElement("div");
  toolbar.className = "work-shift-toolbar";
  const selectAll = document.createElement("button");
  selectAll.type = "button";
  selectAll.className = "button secondary compact";
  selectAll.textContent = "全て許可";
  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.className = "button secondary compact";
  clearAll.textContent = "全て解除";
  const selectedCount = document.createElement("span");
  selectedCount.className = "work-shift-count";
  toolbar.append(selectAll, clearAll, selectedCount);

  const shiftList = document.createElement("div");
  shiftList.className = "work-shift-check-list";
  shiftList.setAttribute("role", "group");
  shiftList.setAttribute("aria-label", "使用可能な勤務シフト");

  const avoidLabel = document.createElement("label");
  avoidLabel.className = "inline-check-label";
  const avoidLateEarly = document.createElement("input");
  avoidLateEarly.type = "checkbox";
  avoidLateEarly.id = "employeeAvoidLateEarlyInput";
  avoidLabel.append(avoidLateEarly, document.createTextNode("遅番の翌日に早番を割り当てない（勤務間隔11時間を目安）"));

  const note = document.createElement("p");
  note.className = "rest-pattern-description";
  note.textContent = "全て許可した状態は保存上「制限なし」として扱います。優先シフトは固定ではなく、必要な時間帯とのバランスを見ながら強く優先します。";

  section.append(
    legend,
    createLabeledControl("優先シフト", preferred),
    toolbar,
    shiftList,
    avoidLabel,
    note
  );
  actions.before(section);

  controls = {
    section,
    preferred,
    selectAll,
    clearAll,
    selectedCount,
    shiftList,
    shiftInputs: [],
    avoidLateEarly
  };

  selectAll.addEventListener("click", () => {
    controls.shiftInputs.forEach((input) => { input.checked = true; });
    syncPreferredAvailability();
  });
  clearAll.addEventListener("click", () => {
    controls.shiftInputs.forEach((input) => { input.checked = false; });
    controls.preferred.value = "";
    syncPreferredAvailability();
  });
  shiftList.addEventListener("change", syncPreferredAvailability);
  return controls;
}

export function populateEmployeeWorkShiftForm(employee) {
  initializeEmployeeWorkShiftForm();
  if (!controls) return;
  renderShiftChecks(employee);
  renderPreferredOptions(employee);
  controls.avoidLateEarly.checked = normalizeAvoidLateEarly(employee?.avoidLateEarly);
  syncPreferredAvailability();
}

export function readEmployeeWorkShiftForm() {
  initializeEmployeeWorkShiftForm();
  if (!controls) {
    return { allowedShiftCodes: [], preferredShiftCode: "", avoidLateEarly: true };
  }
  const allCodes = controls.shiftInputs.map((input) => input.value);
  const selectedCodes = controls.shiftInputs.filter((input) => input.checked).map((input) => input.value);
  const allowedShiftCodes = selectedCodes.length === allCodes.length ? [] : normalizeAllowedShiftCodes(selectedCodes);
  const preferredShiftCode = selectedCodes.length === 0
    ? ""
    : normalizePreferredShiftCode(controls.preferred.value);
  return {
    allowedShiftCodes,
    preferredShiftCode,
    avoidLateEarly: normalizeAvoidLateEarly(controls.avoidLateEarly.checked)
  };
}
