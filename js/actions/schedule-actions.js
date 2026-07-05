import {
  state,
  createId,
  getShift,
  isShiftLocked,
  setShift,
  setBreaksForDate,
  scheduleSave,
  monthDisplayName,
  dateKey,
  removeShiftLocksForEmployee,
  clearShiftLocksForMonth
} from "../model.js";
import { generateBreaksForDate, createBreakOptimizationProposalForDate } from "../breaks.js";
import { normalizeEmploymentType } from "../employment-types.js";
import { compareEmployeeOrder } from "../workspace-normalizer.js";
import { readEmployeeRestForm } from "../employee-rest-form.js";
import { readEmployeeWorkShiftForm } from "../employee-work-shift-form.js";
import { runWithHistory } from "../history.js";
import {
  elements,
  setSaveStatus,
  closeEmployeeDialog,
  confirmAction
} from "../elements.js";
import { refresh } from "./view-actions.js";

let breakOptimizationInFlight = false;

function scoreBreakdownText(breakdown = {}) {
  return `人員:${breakdown.availabilityPenalty ?? 0} / 同時休憩:${breakdown.concurrencyPenalty ?? 0} / 目標時刻:${breakdown.timingPenalty ?? 0} / 制約:${breakdown.hardPenalty ?? 0}`;
}

export function handleShiftChange(select) {
  const day = Number(select.dataset.day);
  const employeeId = select.dataset.employeeId;
  const employeeName = state.employees.find((employee) => employee.id === employeeId)?.name ?? "従業員";
  const changedDate = dateKey(state.selectedMonth, day);
  if (isShiftLocked(employeeId, day)) {
    select.value = getShift(employeeId, day);
    setSaveStatus(`${employeeName}・${day}日はロック済みです。先にロックを解除してください`, true);
    return;
  }
  runWithHistory(`${employeeName}・${day}日のシフト変更`, () => {
    setShift(employeeId, day, select.value, { save: false, respectLock: true });
    generateBreaksForDate(changedDate, [employeeId], { save: false });
    scheduleSave();
  });
  if (state.currentView === "day") state.selectedDate = changedDate;
  refresh();
}

export function saveEmployeeFromDialog() {
  const name = elements.employeeNameInput.value.trim();
  const code = elements.employeeCodeInput.value.trim();
  const department = elements.employeeDepartmentInput.value.trim();
  const fixedOvertimeHours = Number(elements.employeeFixedOvertimeInput.value || 0);
  if (!name || !Number.isFinite(fixedOvertimeHours) || fixedOvertimeHours < 0) return;
  const fixedOvertimeMinutes = Math.round(fixedOvertimeHours * 60);
  const employmentType = normalizeEmploymentType(elements.employeeEmploymentTypeInput.value);
  const restSettings = readEmployeeRestForm();
  const workShiftSettings = readEmployeeWorkShiftForm();
  const orderValue = Number(elements.employeeOrderInput.value);
  const hasValidOrder = Number.isFinite(orderValue) && orderValue > 0;
  const employeeId = elements.employeeIdInput.value;
  const label = employeeId ? "従業員情報を編集" : "従業員を追加";

  runWithHistory(label, () => {
    if (employeeId) {
      const employee = state.employees.find((item) => item.id === employeeId);
      if (employee) {
        Object.assign(employee, {
          name,
          code,
          department,
          employmentType,
          fixedOvertimeMinutes,
          ...restSettings,
          ...workShiftSettings
        });
        if (hasValidOrder) employee.order = orderValue;
      }
    } else {
      state.employees.push({
        id: createId("employee"),
        name,
        code,
        department,
        employmentType,
        fixedOvertimeMinutes,
        ...restSettings,
        ...workShiftSettings,
        order: hasValidOrder ? orderValue : state.employees.length + 1
      });
    }
    state.employees.sort(compareEmployeeOrder);
    scheduleSave();
  });
  closeEmployeeDialog();
  refresh();
}

export async function deleteEmployeeFromDialog() {
  const employeeId = elements.employeeIdInput.value;
  const employee = state.employees.find((item) => item.id === employeeId);
  if (!employee) return;
  closeEmployeeDialog();
  const confirmed = await confirmAction("従業員を削除", `${employee.name}さんと、その人の全月のシフト案・休憩・ロックを削除します。`, "削除");
  if (!confirmed) return;
  runWithHistory(`${employee.name}さんを削除`, () => {
    state.employees = state.employees.filter((item) => item.id !== employeeId);
    for (const month of Object.values(state.shifts)) delete month[employeeId];
    for (const dayBreaks of Object.values(state.breaks)) delete dayBreaks[employeeId];
    removeShiftLocksForEmployee(employeeId, { save: false });
    scheduleSave();
  });
  refresh();
}

export async function autoPlaceBreaks() {
  if (breakOptimizationInFlight) return;
  breakOptimizationInFlight = true;
  const targetDate = state.selectedDate;
  const originalLabel = elements.autoBreakButton.textContent;
  elements.autoBreakButton.disabled = true;
  elements.autoBreakButton.textContent = "最適化中…";
  setSaveStatus("休憩案を作成しています…");

  try {
    const proposal = await createBreakOptimizationProposalForDate(targetDate, { useWorker: true });
    if (!proposal.hardOk) {
      setSaveStatus(`休憩案を作成できませんでした: ${proposal.hardIssues.join(" / ")}`, true);
      return;
    }
    const message = [
      `${targetDate} の休憩案を作成しました。`,
      `スコア ${proposal.initialScore} → ${proposal.optimizedScore}`,
      `改善前内訳: ${scoreBreakdownText(proposal.initialBreakdown)}`,
      `改善後内訳: ${scoreBreakdownText(proposal.optimizedBreakdown)}`,
      `探索: ${proposal.restarts}再始動 / ${proposal.sweeps}周 / ${proposal.elapsedMs}ms`
    ].join(" ");
    const confirmed = await confirmAction("休憩最適化の提案", message, "適用");
    if (!confirmed) {
      setSaveStatus("休憩案の適用をキャンセルしました");
      return;
    }
    runWithHistory("当日の休憩を再配置", () => {
      setBreaksForDate(targetDate, proposal.optimizedBreaks, { save: false });
      scheduleSave();
    });
    refresh();
    setSaveStatus(`休憩を最適化しました（スコア ${proposal.initialScore} → ${proposal.optimizedScore}）`);
  } catch (error) {
    setSaveStatus(`休憩最適化に失敗: ${error.message}`, true);
  } finally {
    breakOptimizationInFlight = false;
    elements.autoBreakButton.disabled = false;
    elements.autoBreakButton.textContent = originalLabel;
  }
}

export async function clearCurrentMonth() {
  const confirmed = await confirmAction("月間シフトをクリア", `${monthDisplayName(state.selectedMonth)}の入力済みシフト案・休憩・セルロックをすべて削除します。`, "クリア");
  if (!confirmed) return;
  runWithHistory(`${monthDisplayName(state.selectedMonth)}をクリア`, () => {
    delete state.shifts[state.selectedMonth];
    for (const dateValue of Object.keys(state.breaks)) {
      if (dateValue.startsWith(state.selectedMonth)) delete state.breaks[dateValue];
    }
    clearShiftLocksForMonth(state.selectedMonth, { save: false });
    scheduleSave();
  });
  refresh();
}
