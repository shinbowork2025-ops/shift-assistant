import { isShiftLocked } from "./model.js";

function syncDailyLocks(container) {
  container.querySelectorAll(".shift-select").forEach((select) => {
    const employeeId = select.dataset.employeeId;
    const day = Number(select.dataset.day);
    const locked = Boolean(employeeId) && Number.isInteger(day) && isShiftLocked(employeeId, day);
    select.disabled = locked;
    select.setAttribute("aria-disabled", String(locked));

    const cell = select.closest(".daily-select-column");
    if (!cell) return;
    cell.classList.toggle("daily-select-locked", locked);
    let label = cell.querySelector(".daily-lock-label");
    if (locked && !label) {
      label = document.createElement("span");
      label.className = "daily-lock-label";
      label.textContent = "ロック済み";
      cell.append(label);
    } else if (!locked) {
      label?.remove();
    }
  });
}

export function initializeDailyLockSync() {
  const container = document.getElementById("dailyChartContainer");
  if (!container) return;
  const sync = () => syncDailyLocks(container);
  new MutationObserver(sync).observe(container, { childList: true });
  sync();
}
