import { state, getActiveWorkspace, monthDisplayName } from "./model.js";

export function createCell(tagName, text, className = "") {
  const cell = document.createElement(tagName);
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

export function workspaceSnapshot() {
  const active = getActiveWorkspace();
  return {
    ...(active ?? {}),
    name: active?.name ?? "無題のシフト表",
    selectedMonth: state.selectedMonth,
    employees: structuredClone(state.employees),
    shiftTypes: structuredClone(state.shiftTypes),
    shifts: structuredClone(state.shifts),
    breaks: structuredClone(state.breaks)
  };
}

function formatPrintedAt(value) {
  return value.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function createDocumentHeader(workspace, monthValue, printedAt, documentType) {
  const header = document.createElement("header");
  header.className = "print-document-header";

  const titleArea = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "print-eyebrow";
  eyebrow.textContent = documentType;
  const title = document.createElement("h1");
  title.textContent = workspace.name;
  const month = document.createElement("p");
  month.className = "print-month-label";
  month.textContent = monthDisplayName(monthValue);
  titleArea.append(eyebrow, title, month);

  const metadata = document.createElement("dl");
  metadata.className = "print-metadata";
  const monthTerm = document.createElement("dt");
  monthTerm.textContent = "対象月";
  const monthValueElement = document.createElement("dd");
  monthValueElement.textContent = monthDisplayName(monthValue);
  const printedTerm = document.createElement("dt");
  printedTerm.textContent = "印刷日時";
  const printedValue = document.createElement("dd");
  printedValue.textContent = formatPrintedAt(printedAt);
  metadata.append(monthTerm, monthValueElement, printedTerm, printedValue);

  header.append(titleArea, metadata);
  return header;
}

export function printWeekendClass(weekday) {
  if (weekday === 0) return "print-sunday";
  if (weekday === 6) return "print-saturday";
  return "";
}
