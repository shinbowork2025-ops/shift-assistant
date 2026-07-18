import { state, workspaceState } from "./model.js";
import { validateMonthReadiness } from "./month-validation.js";

const dashboardStates = new Map();
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

function dashboardKey() {
  return `${workspaceState.activeWorkspaceId ?? "default"}:${state.selectedMonth}`;
}

function errorKey(item) {
  return [
    item.category ?? "other",
    item.employeeId ?? "",
    item.day ?? "",
    ...(item.detailMessages ?? [item.message])
  ].join("|");
}

function currentErrorKeys(result) {
  return new Set(result.issues.filter((item) => item.severity === "error").map(errorKey));
}

function dashboardState(result) {
  const key = dashboardKey();
  const errorKeys = currentErrorKeys(result);
  let value = dashboardStates.get(key);
  if (!value) {
    value = {
      open: result.issues.length > 0 && result.issues.length <= 5,
      userChosen: false,
      acknowledgedErrorKeys: new Set(errorKeys),
      newErrorCount: 0
    };
    dashboardStates.set(key, value);
    return value;
  }

  const newErrors = [...errorKeys].filter((item) => !value.acknowledgedErrorKeys.has(item));
  value.newErrorCount = value.open ? 0 : newErrors.length;
  if (value.open) value.acknowledgedErrorKeys = new Set(errorKeys);
  return value;
}

function acknowledgeVisibleErrors(value, result) {
  value.acknowledgedErrorKeys = currentErrorKeys(result);
  value.newErrorCount = 0;
}

function issueButton(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `month-validation-issue severity-${item.severity}`;
  button.textContent = item.message;
  const details = item.detailMessages ?? [item.message];
  if (details.length > 1) button.title = details.join("\n");
  if (item.day) {
    const actionHint = `${item.day}日の時間帯チャートを開く`;
    button.title = button.title ? `${button.title}\n\n${actionHint}` : actionHint;
    button.addEventListener("click", () => {
      document.querySelector(`.day-view-button[data-day="${item.day}"]`)?.click();
    });
  } else {
    button.disabled = true;
  }
  return button;
}

function countBadge(label, count, className) {
  const badge = document.createElement("span");
  badge.className = `month-validation-count ${className}`;
  badge.textContent = `${label}${count}`;
  return badge;
}

function blankTooltip(result) {
  return result.blankByEmployee
    .map((item) => `${item.employeeName}さん ${item.count}セル`)
    .join("\n");
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
  const viewState = dashboardState(result);

  const header = document.createElement("div");
  header.className = "month-validation-header";
  const title = document.createElement("strong");
  title.textContent = result.ready
    ? "ツール内検証OK"
    : result.blockingCount > 0
      ? `要確認 ${result.blockingCount}件`
      : result.unverifiedCount > 0
        ? `未確認 ${result.unverifiedCount}件`
        : "入力途中";
  title.className = result.ready ? "readiness-ok" : "readiness-ng";

  const counts = document.createElement("div");
  counts.className = "month-validation-counts";
  const blankCount = countBadge("未入力 ", `${result.blankCount}セル`, "blank-count");
  if (result.blankCount > 0) blankCount.title = blankTooltip(result);
  const errorCount = countBadge("エラー ", `${result.blockingCount}件`, "error-count");
  if (viewState.newErrorCount > 0) {
    errorCount.textContent = `エラー ${result.blockingCount}件（新規+${viewState.newErrorCount}）`;
    errorCount.classList.add("has-new-errors");
  }
  const unverifiedCount = countBadge("未確認 ", `${result.unverifiedCount}件`, "unverified-count");
  const warningCount = countBadge("警告 ", `${result.warningCount}件`, "warning-count");
  const infoCount = countBadge("情報 ", `${result.infoCount}件`, "info-count");
  counts.append(blankCount, errorCount, unverifiedCount, warningCount, infoCount);
  header.append(title, counts);

  const details = document.createElement("details");
  details.className = "month-validation-details";
  details.open = viewState.open;
  const detailsSummary = document.createElement("summary");
  detailsSummary.textContent = result.issues.length
    ? `要確認一覧を表示（${result.issues.length}項目）`
    : "空欄以外の問題は検出されませんでした";
  const list = document.createElement("div");
  list.className = "month-validation-list";
  const ordered = [...result.issues].sort((a, b) => {
    const priority = { error: 0, warning: 1, info: 2 };
    return priority[a.severity] - priority[b.severity]
      || (a.day ?? 99) - (b.day ?? 99)
      || String(a.employeeName ?? "").localeCompare(String(b.employeeName ?? ""), "ja");
  });
  for (const item of ordered) list.append(issueButton(item));
  if (!ordered.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = result.blankCount > 0
      ? "現在は未入力セルだけが残っています。"
      : "ツールに設定された必要人数・休憩・休息・連勤・残業・希望休の検査を通過しました。正式登録には担当者の確認が必要です。";
    list.append(empty);
  }
  details.append(detailsSummary, list);
  details.addEventListener("toggle", () => {
    viewState.open = details.open;
    viewState.userChosen = true;
    if (details.open) {
      acknowledgeVisibleErrors(viewState, result);
      errorCount.classList.remove("has-new-errors");
      errorCount.textContent = `エラー ${result.blockingCount}件`;
    }
  });

  target.replaceChildren(header, details);
  target.dataset.ready = String(result.ready);
  target.dataset.blankCount = String(result.blankCount);
  target.dataset.unverifiedCount = String(result.unverifiedCount);
  target.dataset.issueCount = String(result.issues.length);
  return result;
}
