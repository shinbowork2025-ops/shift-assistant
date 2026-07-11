import { getDaysInMonth } from "./date-time.js";
import { state } from "./model.js";
import { getRestPattern } from "./rest-patterns.js";

let initialized = false;
let syncing = false;

function labeled(text, control) {
  const label = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = text;
  label.append(span, control);
  return label;
}

function currentDaysOff(employee, typeMap) {
  const row = [...document.querySelectorAll("#tableContainer .schedule-table tbody tr")]
    .find((candidate) => candidate.querySelector(".employee-button")?.dataset.employeeId === employee.id);
  if (!row) return null;
  return [...row.querySelectorAll(".shift-select")]
    .filter((select) => {
      const shiftType = typeMap.get(select.value);
      return shiftType && !shiftType.isWork;
    }).length;
}

function targetDaysOff(employee, typeMap) {
  const explicit = Math.max(0, Number(employee.targetDaysOff) || 0);
  if (explicit > 0) return explicit;
  const pattern = getRestPattern(employee.restPatternId);
  if (pattern.cycle.length) {
    const offItems = pattern.cycle.filter((item) => item === "off").length;
    return Math.round(getDaysInMonth(state.selectedMonth) * offItems / pattern.cycle.length);
  }
  let existing = 0;
  for (let day = 1; day <= getDaysInMonth(state.selectedMonth); day += 1) {
    const dateValue = `${state.selectedMonth}-${String(day).padStart(2, "0")}`;
    const code = state.shifts?.[state.selectedMonth]?.[employee.id]?.[dateValue] ?? "";
    const shiftType = typeMap.get(code);
    if (shiftType && !shiftType.isWork) existing += 1;
  }
  return existing;
}

function previewDaysOffIssues() {
  const typeMap = new Map(state.shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
  const issues = [];
  for (const employee of state.employees) {
    const actual = currentDaysOff(employee, typeMap);
    if (actual === null) continue;
    const target = targetDaysOff(employee, typeMap);
    if (actual !== target) issues.push(`${employee.name}さん：休日${actual}日（目標${target}日）`);
  }
  return issues;
}

function metricAfter(result, label) {
  for (const row of result.querySelectorAll(".month-solver-metrics > div")) {
    if (row.querySelector("strong")?.textContent !== label) continue;
    const after = row.querySelector("span")?.textContent?.split("→").at(-1) ?? "";
    const number = Number(after.match(/[\d.]+/)?.[0]);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function syncApplyGate(dialog) {
  if (syncing) return;
  syncing = true;
  try {
    const result = dialog.querySelector(".month-solver-result");
    const apply = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "この案を適用");
    if (!result || !apply || !result.querySelector(".month-solver-metrics")) return;

    const title = result.querySelector(":scope > strong");
    const structuralBlocked = title?.textContent === "固定条件に矛盾があります"
      || title?.textContent === "適用条件を満たしていません";
    if (title?.textContent === "固定条件に矛盾があります") title.textContent = "適用条件を満たしていません";

    const reasons = [];
    const shortage = metricAfter(result, "必要人数不足");
    const hard = metricAfter(result, "勤務間隔・連勤違反");
    if (shortage !== null && shortage > 0) reasons.push(`必要人数不足 ${shortage}人枠`);
    if (hard !== null && hard > 0) reasons.push(`勤務間隔・連勤違反 ${hard}件`);
    reasons.push(...previewDaysOffIssues());

    const blocked = structuralBlocked || reasons.length > 0;
    apply.hidden = blocked;
    let note = result.querySelector(".month-solver-apply-gate");
    if (blocked) {
      if (!note) {
        note = document.createElement("p");
        note.className = "month-solver-apply-gate";
        result.append(note);
      }
      const detail = reasons.length ? reasons.join(" / ") : "固定セルまたは使用可能なシフト区分を確認してください。";
      note.textContent = `この案は適用できません。${detail}`;
    } else {
      note?.remove();
    }
  } finally {
    syncing = false;
  }
}

function simplifySettings(dialog) {
  const settings = dialog.querySelector(".month-solver-settings");
  if (!settings || settings.dataset.simplified === "1") return;
  const labels = [...settings.querySelectorAll(":scope > label")];
  const modeLabel = labels[0];
  const seedLabel = labels[1];
  const iterationsLabel = labels[2];
  const mode = modeLabel?.querySelector("select");
  const iterations = iterationsLabel?.querySelector("input");
  if (!mode || !seedLabel || !iterationsLabel || !iterations) return;

  settings.dataset.simplified = "1";
  const profile = document.createElement("select");
  for (const [value, text] of [
    ["fast", "高速（短時間で案を確認）"],
    ["standard", "標準（推奨）"],
    ["precision", "精密（最大3分）"]
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    profile.append(option);
  }
  profile.value = "standard";
  const profileLabel = labeled("実行方法", profile);
  settings.insertBefore(profileLabel, modeLabel);
  modeLabel.hidden = true;

  const profileNote = document.createElement("p");
  profileNote.className = "month-solver-profile-note muted";
  settings.append(profileNote);

  const advanced = document.createElement("details");
  advanced.className = "month-solver-advanced";
  const advancedSummary = document.createElement("summary");
  advancedSummary.textContent = "詳細設定";
  const advancedGrid = document.createElement("div");
  advancedGrid.className = "month-solver-advanced-grid";
  advancedGrid.append(seedLabel, iterationsLabel);
  advanced.append(advancedSummary, advancedGrid);
  settings.insertAdjacentElement("afterend", advanced);

  const applyProfile = () => {
    if (profile.value === "precision") {
      mode.value = "precision";
      profileNote.textContent = "最大3分間探索し、その時間内に見つかった最良案を表示します。";
    } else {
      mode.value = "fast";
      iterations.value = profile.value === "fast" ? "4000" : "12000";
      profileNote.textContent = profile.value === "fast"
        ? "結果を早く確認するための設定です。"
        : "通常の月間作成ではこの設定を推奨します。";
    }
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  };
  profile.addEventListener("change", applyProfile);
  applyProfile();
}

export function initializeMonthSolverSimpleUi() {
  if (initialized) return;
  initialized = true;
  const dialog = document.querySelector("dialog.month-solver-dialog");
  if (!dialog) return;
  simplifySettings(dialog);
  const result = dialog.querySelector(".month-solver-result");
  if (result) {
    new MutationObserver(() => queueMicrotask(() => syncApplyGate(dialog)))
      .observe(result, { childList: true, subtree: true, characterData: true });
  }
  dialog.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button?.textContent !== "この案を適用") return;
    syncApplyGate(dialog);
    if (button.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}
