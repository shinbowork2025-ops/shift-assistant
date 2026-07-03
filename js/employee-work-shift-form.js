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
  automatic.textContent = "自動（旦存傾向と配置バランスを優先）";
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

function ensureAtLeastOneShift(fallbackInput = null) {
  if (!controls.shiftInputs.length || controls.shiftInputs.some((input) => input.checked)) return;
  const fallback = fallbackInput ?? controls.shiftInputs[0];
  if (fallback) fallback.checked = true;
}

function syncPreferredAvailability() {
  if (!controls) return;
  ensureAtLeastOneShift();
  const checked = new Set(controls.shiftInputs.filter((input) => input.checked).map((input) => input.value));
  const allSelected = controls.shiftInputs.length > 0 && checked.size === controls.shiftInputs.length;
  for (const option of controls.preferred.options) {
    option.disabled = option.value !== "" && !allSelected && !checked.has(option.value);
  }
  if (controls.preferred.value && !allSelected && !checked.has(controls.preferred.value)) {
    controls.preferred.value = "";
  }
  controls.selectedCount.textContent = controls.shiftInputs.length
    ? `${checked.size}/${controls.shiftInputs.length}章馞を見叼
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
  legend.textContent = "勧務シフトの自動割当設定";

  const preferred = document.createElement("select");
  preferred.id = "employeePreferredShiftInput";

  const toolbar = document.createElement("div");
  toolbar.className = "work-shift-toolbar";
  const selectAll = document.createElement("button");
  selectAll.type = "button";
  selectAll.className = "button secondary compact";
  selectAll.textContent = "全て許可";
  const narrowSelection = document.createElement("button");
  narrowSelection.type = "button";
  narrowSelection.className = "button secondary compact";
  narrowSelection.textContent = "先頭だけ許可";
  const selectedCount = document.createElement("span");
  selectedCount.className = "work-shift-count";
  toolbar.append(selectAll, narrowSelection, selectedCount);

  const shiftList = document.createElement("div");
  shiftList.className = "work-shift-check-list";
  shiftList.setAttribute("role", "group");
  shiftList.setAttribute("aria-label", "使用可能な勧務シフト");

  const avoidLabel = document.createElement("label");
  avoidLabel.className = "inline-check-label";
  const avoidLateEarly = document.createElement("input");
  avoidLateEarly.type = "checkbox";
  avoidLateEarly.id = "employeeAvoidLateEarlyInput";
  avoidLabel.append(avoidLateEarly, document.createTextNode("遅番の翌日に早番を割り当てない（務務間隔11時間を目安）");

  const note = document.createElement("p");
  note.className = "rest-pattern-description";
  note.textContent = "使用可能な務務シフトは最低1章馞必要です。八章馞を見召する状態の保存上『制�nなし』ににります。優先シフトは固定ではく、必要な晒�⿎����C���ώ
�
K���j��c強く優先します。";

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
    narrowSelection,
    selectedCount,
    shiftList,
    shiftInputs: [],
    avoidLateEarly
  };

  selectAll.addEventListener("click", () => {
    controls.shiftInputs.forEach((input) => { input.checked = true; });
    syncPreferredAvailability();
  });
  narrowSelection.addEventListener("click", () => {
    controls.shiftInputs.forEach((input, index) => { input.checked = index === 0; });
    controls.preferred.value = "";
    syncPreferredAvailability();
  });
  shiftList.addEventListener("change", (event) => {
    ensureAtLeastOneShift(event.target);
    syncPreferredAvailability();
  });
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
  ensureAtLeastOneShift();
  const allCodes = controls.shiftInputs.map((input) => input.value);
  const selectedCodes = controls.shiftInputs.filter((input) => input.checked).map((input) => input.value);
  const allowedShiftCodes = selectedCodes.length === allCodes.length ? [] : normalizeAllowedShiftCodes(selectedCodes);
  return {
    allowedShiftCodes,
    preferredShiftCode: normalizePreferredShiftCode(controls.preferred.value),
    avoidLateEarly: normalizeAvoidLateEarly(controls.avoidLateEarly.checked)
  };
}
