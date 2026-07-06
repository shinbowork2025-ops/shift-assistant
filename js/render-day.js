import { state } from "./model.js";
import { buildDailyOverview } from "./daily-overview.js";
import { EMPLOYMENT_TYPES, employmentTypeShortLabel, employmentTypeLabel } from "./employment-types.js";
import {
  shiftToneClass,
  createHeaderCell,
  createDataCell,
  createShiftSelect
} from "./render-common.js";

function validationMessage(validation) {
  const summary = `実働${validation.work}分 / 休憩${validation.actual}分 / 必要${validation.required}分`;
  return [summary, ...validation.issues].join("\n");
}

function timelineClass(cell) {
  if (cell.kind === "work") return `timeline-work ${shiftToneClass(cell.shiftCode)}`;
  if (cell.kind === "break") {
    return cell.breakType === "lunch"
      ? "timeline-break timeline-lunch"
      : "timeline-break timeline-small-break";
  }
  return "timeline-off";
}

export function renderDailyTable(elements) {
  const overview = buildDailyOverview({
    dateValue: state.selectedDate,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    breaks: state.breaks,
    coverageRequirements: state.coverageRequirements
  });
  const evaluation = overview.requirementEvaluation;
  const table = document.createElement("table");
  table.className = "daily-chart-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.append(createHeaderCell("従業員", "daily-employee-column"));
  headerRow.append(createHeaderCell("シフト", "daily-select-column"));
  for (const slot of overview.slots) {
    const cell = createHeaderCell(slot % 60 === 0 ? `${String(Math.floor(slot / 60)).padStart(2, "0")}:00` : "", "timeline-header-cell");
    if (slot % 60 === 0) cell.classList.add("hour-start");
    headerRow.append(cell);
  }
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const rowData of overview.rows) {
    const { employee, shiftCode, shiftType, validation, cells, employmentType } = rowData;
    const row = document.createElement("tr");
    if (!validation.ok) row.classList.add("break-invalid-row");

    const nameCell = document.createElement("th");
    nameCell.scope = "row";
    nameCell.className = "daily-employee-column";
    const typeTag = document.createElement("span");
    typeTag.className = `employment-tag employment-${employmentType}`;
    typeTag.textContent = employmentTypeShortLabel(employmentType);
    typeTag.title = employmentTypeLabel(employmentType);
    typeTag.setAttribute("aria-label", employmentTypeLabel(employmentType));
    nameCell.append(typeTag, document.createTextNode(employee.name));
    if (!validation.ok) {
      const warning = document.createElement("span");
      warning.className = "break-warning";
      warning.textContent = "⚠ 休憩確認";
      warning.title = validationMessage(validation);
      warning.setAttribute("aria-label", `休憩確認: ${validationMessage(validation)}`);
      nameCell.append(warning);
    }
    row.append(nameCell);

    const selectCell = document.createElement("td");
    selectCell.className = "daily-select-column";
    if (!validation.ok) selectCell.title = validationMessage(validation);
    const selectWrap = document.createElement("div");
    selectWrap.className = "daily-select-wrap";
    selectWrap.append(createShiftSelect(employee, overview.day, shiftCode, true));
    if (shiftType?.isWork) {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "break-edit-button";
      editButton.dataset.employeeId = employee.id;
      editButton.title = "休憩を編集";
      editButton.setAttribute("aria-label", `${employee.name}さんの休憩を編集`);
      editButton.textContent = "休憩✎";
      selectWrap.append(editButton);
    }
    selectCell.append(selectWrap);
    row.append(selectCell);

    cells.forEach((cellData, index) => {
      const slot = overview.slots[index];
      const cell = document.createElement("td");
      cell.className = `timeline-cell ${timelineClass(cellData)}`;
      cell.dataset.employeeId = employee.id;
      cell.dataset.employeeName = employee.name;
      cell.dataset.shiftCode = shiftCode;
      cell.dataset.day = String(overview.day);
      cell.dataset.dateValue = overview.dateValue;
      cell.dataset.slotStart = String(slot);
      if (!validation.ok && cellData.kind === "work") cell.classList.add("timeline-break-invalid");
      if (slot % 60 === 0) cell.classList.add("hour-start");
      if (cellData.title) cell.title = cellData.title;
      if (cellData.kind === "work" || cellData.kind === "break") {
        cell.classList.add("break-drop-target");
      }
      if (cellData.kind === "break") {
        cell.draggable = true;
        cell.classList.add("break-draggable");
        if (cellData.isBreakStart) {
          cell.classList.add("break-drag-handle");
          cell.textContent = "移";
        }
        cell.dataset.breakIndex = String(cellData.breakIndex);
        cell.dataset.breakStart = String(cellData.breakStart);
        cell.dataset.breakEnd = String(cellData.breakEnd);
        cell.setAttribute("aria-label", `${employee.name}さんの${cellData.title}をドラッグして移動`);
      }
      row.append(cell);
    });
    tbody.append(row);
  }
  table.append(tbody);

  const tfoot = document.createElement("tfoot");
  const slotLabel = (slot) => `${Math.floor(slot / 60)}:${String(slot % 60).padStart(2, "0")}`;

  // 必要人数が設定されていれば、合計の必要人数行を先頭に置いて基準を示す。
  if (evaluation.hasAnyRequirement) {
    const requiredRow = document.createElement("tr");
    requiredRow.className = "coverage-required-row";
    requiredRow.append(createHeaderCell("必要人数", "daily-employee-column"));
    requiredRow.append(createDataCell("合計", "daily-select-column"));
    evaluation.perSlot.forEach((slotInfo, index) => {
      const slot = overview.slots[index];
      const text = slotInfo.hasRequirement && slotInfo.requiredTotal > 0 ? String(slotInfo.requiredTotal) : "";
      const cell = createDataCell(text, "coverage-cell coverage-required-cell");
      if (slot % 60 === 0) cell.classList.add("hour-start");
      if (text) cell.title = `${slotLabel(slot)} 必要合計${slotInfo.requiredTotal}人`;
      requiredRow.append(cell);
    });
    tfoot.append(requiredRow);
  }

  // 雇用区分ごとに必要人数が異なるため、区分別の実配置人数を先に示し、
  // 最後に従来どおり合計を警告色付きで表示する。不足セルは赤で強調する。
  for (const type of EMPLOYMENT_TYPES) {
    const typeRow = document.createElement("tr");
    typeRow.className = "employment-coverage-row";
    typeRow.append(createHeaderCell(type.label, "daily-employee-column"));
    typeRow.append(createDataCell("休憩除外", "daily-select-column"));
    overview.coverageByType[type.code].forEach((count, index) => {
      const slot = overview.slots[index];
      const short = evaluation.perSlot[index]?.byTypeShort[type.code] ?? 0;
      const classes = ["coverage-cell", "employment-coverage-cell"];
      if (short > 0) classes.push("coverage-short");
      else if (count === 0) classes.push("employment-coverage-empty");
      const cell = createDataCell(String(count), classes.join(" "));
      if (slot % 60 === 0) cell.classList.add("hour-start");
      cell.title = short > 0
        ? `${slotLabel(slot)} ${type.label}${count}人（${short}人不足）`
        : `${slotLabel(slot)} ${type.label}${count}人`;
      typeRow.append(cell);
    });
    tfoot.append(typeRow);
  }

  const coverageRow = document.createElement("tr");
  coverageRow.append(createHeaderCell("実配置合計", "daily-employee-column"));
  coverageRow.append(createDataCell("休憩除外", "daily-select-column"));
  overview.coverage.forEach((count, index) => {
    const slot = overview.slots[index];
    const short = evaluation.perSlot[index]?.totalShort ?? 0;
    const statusClass = short > 0
      ? "coverage-short"
      : count === 0 ? "coverage-zero" : count === 1 ? "coverage-low" : "coverage-ok";
    const cell = createDataCell(String(count), `coverage-cell ${statusClass}`);
    if (slot % 60 === 0) cell.classList.add("hour-start");
    cell.title = short > 0
      ? `${slotLabel(slot)} 実配置${count}人（${short}人不足）`
      : `${slotLabel(slot)} 実配置${count}人`;
    coverageRow.append(cell);
  });
  tfoot.append(coverageRow);
  table.append(tfoot);

  elements.dailyChartContainer.replaceChildren(table);
  elements.dailyEmptyState.hidden = state.employees.length > 0;
  elements.dailyChartContainer.hidden = state.employees.length === 0;
  renderCoverageSummary(elements, evaluation);
}

function renderCoverageSummary(elements, evaluation) {
  const summary = elements.coverageSummary;
  if (!summary) return;
  summary.hidden = state.employees.length === 0;
  if (!evaluation.hasAnyRequirement) {
    summary.className = "coverage-summary muted";
    summary.textContent = "必要人数は未設定です。「必要人数を設定」から時間帯ごとの必要人数を登録できます。";
    return;
  }
  if (evaluation.messages.length === 0) {
    summary.className = "coverage-summary coverage-summary-ok";
    summary.textContent = "✓ 設定した必要人数を満たしています。";
    return;
  }
  summary.className = "coverage-summary coverage-summary-short";
  summary.textContent = `⚠ 必要人数の不足　${evaluation.messages.join("　／　")}`;
}
