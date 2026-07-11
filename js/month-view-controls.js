import { state } from "./model.js";

let controls = null;
let selectedEmployeeIds = new Set();
let employeeSignature = "";
let compact = false;

function signature() {
  return state.employees.map((employee) => employee.id).join("|");
}

function ensureEmployeeSelection() {
  const nextSignature = signature();
  if (nextSignature === employeeSignature) return false;
  employeeSignature = nextSignature;
  selectedEmployeeIds = new Set(state.employees.map((employee) => employee.id));
  return true;
}

function selectedText() {
  const total = state.employees.length;
  const selected = state.employees.filter((employee) => selectedEmployeeIds.has(employee.id)).length;
  return selected === total ? `全員（${total}人）` : `${selected}/${total}人`;
}

function applyRowFilter() {
  const rows = document.querySelectorAll("#tableContainer .schedule-table tbody tr");
  for (const row of rows) {
    const employeeId = row.querySelector(".employee-button")?.dataset.employeeId;
    row.hidden = Boolean(employeeId) && !selectedEmployeeIds.has(employeeId);
  }
}

function syncCompact() {
  const tableContainer = document.querySelector("#tableContainer");
  tableContainer?.classList.toggle("month-compact", compact);
  if (controls) {
    controls.compactButton.classList.toggle("primary", compact);
    controls.compactButton.classList.toggle("secondary", !compact);
    controls.compactButton.setAttribute("aria-pressed", String(compact));
    controls.compactButton.textContent = compact ? "標準表示に戻す" : "コンパクト表示";
  }
}

function updateSummary() {
  if (!controls) return;
  controls.filterSummary.textContent = `従業員を絞り込む：${selectedText()}`;
  controls.status.textContent = `表示対象 ${selectedText()}。絞り込みは画面表示だけに作用し、集計・印刷・ソルバーには影響しません。`;
}

function renderEmployeeOptions() {
  if (!controls) return;
  const fragment = document.createDocumentFragment();
  for (const employee of state.employees) {
    const label = document.createElement("label");
    label.className = "employee-filter-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = employee.id;
    input.checked = selectedEmployeeIds.has(employee.id);
    input.addEventListener("change", () => {
      if (input.checked) selectedEmployeeIds.add(employee.id);
      else selectedEmployeeIds.delete(employee.id);
      applyRowFilter();
      updateSummary();
    });
    const detail = [employee.department, employee.code].filter(Boolean).join(" / ");
    const text = document.createElement("span");
    text.textContent = detail ? `${employee.name}（${detail}）` : employee.name;
    label.append(input, text);
    fragment.append(label);
  }
  controls.employeeList.replaceChildren(fragment);
}

function syncView() {
  const employeesChanged = ensureEmployeeSelection();
  if (employeesChanged) renderEmployeeOptions();
  applyRowFilter();
  syncCompact();
  updateSummary();
}

export function initializeMonthViewControls() {
  if (controls) return controls;
  const slot = document.querySelector("#monthToolsSlot");
  const tableContainer = document.querySelector("#tableContainer");
  if (!slot || !tableContainer) return null;

  const panel = document.createElement("section");
  panel.className = "month-view-controls";
  panel.setAttribute("aria-label", "月間表の表示設定");
  const heading = document.createElement("div");
  heading.className = "month-view-controls-heading";
  const title = document.createElement("strong");
  title.textContent = "表示設定";
  const status = document.createElement("p");
  status.className = "month-view-controls-status";
  heading.append(title, status);

  const actions = document.createElement("div");
  actions.className = "month-view-controls-actions";
  const compactButton = document.createElement("button");
  compactButton.type = "button";
  compactButton.className = "button secondary";
  compactButton.addEventListener("click", () => {
    compact = !compact;
    syncCompact();
  });

  const filter = document.createElement("details");
  filter.className = "employee-filter";
  const filterSummary = document.createElement("summary");
  const filterBody = document.createElement("div");
  filterBody.className = "employee-filter-body";
  const filterActions = document.createElement("div");
  filterActions.className = "compact-button-row";
  const selectAll = document.createElement("button");
  selectAll.type = "button";
  selectAll.className = "button secondary";
  selectAll.textContent = "全員を表示";
  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.className = "button secondary";
  clearAll.textContent = "全員を隠す";
  filterActions.append(selectAll, clearAll);
  const employeeList = document.createElement("div");
  employeeList.className = "employee-filter-list";
  filterBody.append(filterActions, employeeList);
  filter.append(filterSummary, filterBody);
  actions.append(compactButton, filter);
  panel.append(heading, actions);

  selectAll.addEventListener("click", () => {
    selectedEmployeeIds = new Set(state.employees.map((employee) => employee.id));
    renderEmployeeOptions();
    syncView();
  });
  clearAll.addEventListener("click", () => {
    selectedEmployeeIds.clear();
    renderEmployeeOptions();
    syncView();
  });

  const editToolbar = slot.querySelector(".month-edit-toolbar");
  if (editToolbar) editToolbar.insertAdjacentElement("afterend", panel);
  else slot.prepend(panel);

  controls = { panel, status, compactButton, filterSummary, employeeList };
  new MutationObserver(syncView).observe(tableContainer, { childList: true, subtree: true });
  syncView();
  return controls;
}
