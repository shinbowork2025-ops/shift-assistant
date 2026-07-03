import { state } from "./model.js";
import { employeeRestPatternSummary } from "./rest-patterns.js";
import { workShiftPreferenceSummary } from "./work-shift-preferences.js";

function syncBadges(tableContainer) {
  const workShiftTypes = state.shiftTypes.filter((shiftType) => shiftType.isWork);
  tableContainer.querySelectorAll(".employee-button").forEach((button) => {
    const employee = state.employees.find((item) => item.id === button.dataset.employeeId);
    const details = button.querySelector(".employee-code");
    if (!employee || !details) return;

    let restBadge = details.querySelector(".employee-rest-badge");
    if (!restBadge) {
      restBadge = document.createElement("span");
      restBadge.className = "employee-rest-badge";
      details.append(restBadge);
    }
    restBadge.textContent = `休み:${employeeRestPatternSummary(employee)}`;

    let workBadge = details.querySelector(".employee-work-badge");
    if (!workBadge) {
      workBadge = document.createElement("span");
      workBadge.className = "employee-work-badge";
      details.append(workBadge);
    }
    workBadge.textContent = `勤務:${workShiftPreferenceSummary(employee, workShiftTypes)}`;
  });
}

export function initializeEmployeeRestBadges(tableContainer) {
  const sync = () => syncBadges(tableContainer);
  new MutationObserver(sync).observe(tableContainer, { childList: true });
  sync();
}
