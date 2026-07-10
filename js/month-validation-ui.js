import { state } from "./model.js";
import { validateMonthReadiness } from "./month-validation.js";

let panel = null;

function ensurePanel() {
  if (panel) return panel;
  const slot = document.querySelector("#monthResultsSlot");
  if (!slot) return null;
  panel = document.createElement("section");
  panel.className = "month-validation-panel";
  panel.setAttribute("aria-label", "月間シフトの要確認一覧");
  slot.prepend(panel);
  return panel;
}

function issueButton(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `month-validation-issue severity-${item.severity}`;
  button.textContent = item.message;
  if (item.day) {
    button.title = `${item.day}日の時間帯チャートを開く`;
    button.addEventListener("click", () => {
      document.querySelector(`.day-view-button[data-day="${item.day}"]`)?.click();
    });
  } else {
    button.disabled = true;
  }
  return button;
}

export function renderMonthValidationDashboard() {
  const target = ensurePanel();
  if (!target) return null;
  const result = validateMonthReadiness({
    monthValue: state.selectedMonth,
    employees: state.employees,
    shiftTypes: state.shiftTypes,
    shifts: state.shifts,
    breaks: state.breaks,
    shiftLocks: state.shiftLocks,
    requestedDaysOff: state.requestedDaysOff,
    manualBreakLocks: state.manualBreakLocks,
    coverageRequirements: state.coverageRequirements
  });

  const header = document.createElement("div");
  header.className = "month-validation-header";
  const title = document.createElement("strong");
  title.textContent = result.ready ? "転記準備OK" : `要確認 ${result.blockingCount}件`;
  title.className = result.ready ? "readiness-ok" : "readiness-ng";
  const summary = document.createElement("span");
  summary.textContent = `警告${result.warningCount}件 / 情報${result.infoCount}件`;
  header.append(title, summary);

  const details = document.createElement("details");
  details.className = "month-validation-details";
  details.open = !result.ready;
  const detailsSummary = document.createElement("summary");
  detailsSummary.textContent = result.issues.length ? "要確認一覧を表示" : "問題は検出されませんでした";
  const list = document.createElement("div");
  list.className = "month-validation-list";
  const ordered = [...result.issues].sort((a, b) => {
    const priority = { error: 0, warning: 1, info: 2 };
    return priority[a.severity] - priority[b.severity] || (a.day ?? 99) - (b.day ?? 99);
  });
  for (const item of ordered) list.append(issueButton(item));
  if (!ordered.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "必要人数・休憩・休息・連勤・残業・希望休を確認済みです。";
    list.append(empty);
  }
  details.append(detailsSummary, list);
  target.replaceChildren(header, details);
  target.dataset.ready = String(result.ready);
  return result;
}
