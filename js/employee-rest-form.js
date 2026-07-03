import {
  REST_PATTERNS,
  getRestPattern,
  normalizeFixedDaysOff,
  normalizeRestPatternId,
  normalizeRestPatternOffset,
  normalizeTargetDaysOff,
  weekdayLabel
} from "./rest-patterns.js";

let controls = null;

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

function createPatternSelect() {
  const select = document.createElement("select");
  select.id = "employeeRestPatternInput";
  for (const pattern of REST_PATTERNS) {
    const option = document.createElement("option");
    option.value = pattern.id;
    option.textContent = pattern.name;
    select.append(option);
  }
  return select;
}

function createOffsetSelect() {
  const select = document.createElement("select");
  select.id = "employeeRestPatternOffsetInput";
  const automatic = document.createElement("option");
  automatic.value = "-1";
  automatic.textContent = "自動（表示順で分散）";
  select.append(automatic);
  for (let offset = 0; offset <= 10; offset += 1) {
    const option = document.createElement("option");
    option.value = String(offset);
    option.textContent = offset === 0 ? "0日（周期の先頭から）" : `${offset}日ずらす`;
    select.append(option);
  }
  return select;
}

function createWeekdayChecks() {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "weekday-checks";
  const legend = document.createElement("legend");
  legend.textContent = "固定休曜日（任意）";
  fieldset.append(legend);
  const inputs = [];
  for (let day = 0; day <= 6; day += 1) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "employeeFixedDayOff";
    input.value = String(day);
    label.append(input, document.createTextNode(weekdayLabel(day)));
    fieldset.append(label);
    inputs.push(input);
  }
  return { fieldset, inputs };
}

function updatePatternDescription() {
  if (!controls) return;
  const pattern = getRestPattern(controls.pattern.value);
  controls.description.textContent = pattern.description;
  controls.offset.disabled = pattern.id === "none";
  controls.target.disabled = pattern.id === "none";
  controls.weekdayInputs.forEach((input) => { input.disabled = pattern.id === "none"; });
}

export function initializeEmployeeRestForm() {
  if (controls) return controls;
  const form = document.getElementById("employeeForm");
  const actions = form?.querySelector(".dialog-actions");
  if (!form || !actions) return null;

  const section = document.createElement("fieldset");
  section.className = "employee-rest-settings";
  const legend = document.createElement("legend");
  legend.textContent = "公休の自動配置設定";
  const pattern = createPatternSelect();
  const offset = createOffsetSelect();
  const target = document.createElement("input");
  target.id = "employeeTargetDaysOffInput";
  target.type = "number";
  target.min = "0";
  target.max = "31";
  target.step = "1";
  target.value = "0";
  target.inputMode = "numeric";
  const weekdays = createWeekdayChecks();
  const description = document.createElement("p");
  description.className = "rest-pattern-description";

  section.append(
    legend,
    createLabeledControl("休み方", pattern),
    description,
    createLabeledControl("月間公休日数", target, "0は休み方パターンから自動計算します。"),
    createLabeledControl("パターン開始位置", offset, "自動にすると従業員の表示順で休みを分散します。"),
    weekdays.fieldset
  );
  actions.before(section);
  controls = { section, pattern, offset, target, weekdayInputs: weekdays.inputs, description };
  pattern.addEventListener("change", updatePatternDescription);
  updatePatternDescription();
  return controls;
}

export function populateEmployeeRestForm(employee) {
  initializeEmployeeRestForm();
  if (!controls) return;
  controls.pattern.value = normalizeRestPatternId(employee?.restPatternId);
  controls.offset.value = String(normalizeRestPatternOffset(employee?.restPatternOffset));
  controls.target.value = String(normalizeTargetDaysOff(employee?.targetDaysOff));
  const fixedDays = new Set(normalizeFixedDaysOff(employee?.fixedDaysOff));
  controls.weekdayInputs.forEach((input) => { input.checked = fixedDays.has(Number(input.value)); });
  updatePatternDescription();
}

export function readEmployeeRestForm() {
  initializeEmployeeRestForm();
  if (!controls) {
    return { restPatternId: "none", restPatternOffset: -1, targetDaysOff: 0, fixedDaysOff: [] };
  }
  return {
    restPatternId: normalizeRestPatternId(controls.pattern.value),
    restPatternOffset: normalizeRestPatternOffset(controls.offset.value),
    targetDaysOff: normalizeTargetDaysOff(controls.target.value),
    fixedDaysOff: controls.weekdayInputs.filter((input) => input.checked).map((input) => Number(input.value))
  };
}
