import { state } from "./model.js";
import { employeeRestPatternSummary } from "./rest-patterns.js";

function syncBadges(tableContainer) {
  tableContainer.querySelectorAll(".employee-button").forEach((button) => {
    const employee = state.employees.find((item) => item.id === button.dataset.employeeId);
    const details = button.querySelector(".employee-code");
    if (!employee || !details) return;
    let badge = details.querySelector(".employee-rest-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "employee-rest-badge";
      details.append(badge);
    }
    const summary = employeeRestPatternSummary(employee);
    badge.textContent = `休み:${summary}`;
  });
}

export function initializeEmployeeRestBadges(tableContainer) {
  const sync = () => syncBadges(tableContainer);
  new MutationObserver(sync).observe(tableContainer, { childList: true });
  sync();
}
