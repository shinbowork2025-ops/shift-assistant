import {
  state,
  dayFromDate,
  scheduleSave,
  setBreaksForDate,
  timeToMinutes
} from "./model.js";
import { buildShiftTypeMap, getShiftCodeFromData } from "./month-overview.js";
import { checkHard } from "./scoring.js";
import { runWithHistory } from "./history.js";
import { setSaveStatus } from "./elements.js";
import { refresh } from "./actions/view-actions.js";

let panel = null;
let chartContainer = null;

function currentShiftType(employeeId) {
  const dateValue = state.selectedDate;
  const monthValue = dateValue.slice(0, 7);
  const day = dayFromDate(dateValue);
  const typeMap = buildShiftTypeMap(state.shiftTypes);
  const code = getShiftCodeFromData(state.shifts, monthValue, employeeId, day);
  return typeMap.get(code) ?? null;
}

function numericBreaks(items) {
  return items.map((item) => ({
    ...item,
    start: timeToMinutes(item.start),
    end: timeToMinutes(item.end),
    target: timeToMinutes(item.start)
  }));
}

function validateEditedBreaks(employeeId, items) {
  const shiftType = currentShiftType(employeeId);
  if (!shiftType?.isWork) return { ok: false, issues: ["勤務シフトが見つかりません。"] };
  return checkHard({
    employees: [{
      id: employeeId,
      shiftStart: timeToMinutes(shiftType.start),
      shiftEnd: timeToMinutes(shiftType.end),
      breaks: numericBreaks(items)
    }]
  }, {
    edgeBufferMinutes: 60,
    minimumBreakGapMinutes: 60
  });
}

function applyEdit(employeeId, itemIndex, field, value) {
  const dateValue = state.selectedDate;
  const next = structuredClone(state.breaks[dateValue] ?? {});
  const items = next[employeeId] ?? [];
  const item = items[itemIndex];
  if (!item) return;

  if (field === "locked") {
    item.locked = Boolean(value);
  } else {
    item[field] = value;
    item.locked = true;
    const validation = validateEditedBreaks(employeeId, items);
    if (!validation.ok) {
      setSaveStatus(`休憩時刻を変更できません: ${validation.issues.join("、")}`, true);
      renderEditor();
      return;
    }
  }

  const employeeName = state.employees.find((employee) => employee.id === employeeId)?.name ?? "従業員";
  runWithHistory(`${employeeName}の休憩を編集`, () => {
    setBreaksForDate(dateValue, next, { save: false });
    scheduleSave();
  });
  refresh();
  setSaveStatus(field === "locked" ? "休憩の固定状態を変更しました" : "休憩時刻を変更して固定しました");
}

function timeInput(employeeId, itemIndex, field, value) {
  const input = document.createElement("input");
  input.type = "time";
  input.step = "900";
  input.value = value;
  input.setAttribute("aria-label", field === "start" ? "休憩開始" : "休憩終了");
  input.addEventListener("change", () => applyEdit(employeeId, itemIndex, field, input.value));
  return input;
}

function breakRow(employeeId, item, itemIndex) {
  const row = document.createElement("div");
  row.className = "rest-editor-row";
  const label = document.createElement("span");
  label.textContent = item.label || (item.type === "small" ? "小休憩" : "昼休憩");
  const start = timeInput(employeeId, itemIndex, "start", item.start);
  const end = timeInput(employeeId, itemIndex, "end", item.end);
  const lockLabel = document.createElement("label");
  lockLabel.className = "rest-editor-lock";
  const lock = document.createElement("input");
  lock.type = "checkbox";
  lock.checked = Boolean(item.locked);
  lock.addEventListener("change", () => applyEdit(employeeId, itemIndex, "locked", lock.checked));
  lockLabel.append(lock, document.createTextNode("固定"));
  row.append(label, start, end, lockLabel);
  return row;
}

function renderEditor() {
  if (!panel) return;
  panel.hidden = state.currentView !== "day";
  if (panel.hidden) return;

  const dateBreaks = state.breaks[state.selectedDate] ?? {};
  const list = document.createElement("div");
  list.className = "rest-editor-list";
  let count = 0;

  for (const employee of state.employees) {
    const items = dateBreaks[employee.id] ?? [];
    if (!items.length) continue;
    count += 1;
    const group = document.createElement("section");
    group.className = "rest-editor-employee";
    const name = document.createElement("strong");
    name.textContent = employee.name;
    group.append(name);
    items.forEach((item, index) => group.append(breakRow(employee.id, item, index)));
    list.append(group);
  }

  if (!count) {
    const empty = document.createElement("p");
    empty.textContent = "編集できる休憩がありません。先に休憩案を作成してください。";
    list.append(empty);
  }
  panel.querySelector(".rest-editor-list")?.replaceWith(list);
}

function createPanel() {
  panel = document.createElement("section");
  panel.className = "rest-editor";
  const header = document.createElement("div");
  header.className = "rest-editor-header";
  const title = document.createElement("h3");
  title.textContent = "休憩時刻の調整";
  const note = document.createElement("p");
  note.textContent = "時刻を変更した休憩は自動的に固定され、次回の最適化でも動きません。";
  header.append(title, note);
  const list = document.createElement("div");
  list.className = "rest-editor-list";
  panel.append(header, list);
  chartContainer.insertAdjacentElement("afterend", panel);
}

export function initializeTimeEditor(container) {
  chartContainer = container;
  createPanel();
  new MutationObserver(renderEditor).observe(container, { childList: true });
  renderEditor();
}
