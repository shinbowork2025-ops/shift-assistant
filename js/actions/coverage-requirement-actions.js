import { state, setCoverageRequirements, scheduleSave } from "../model.js";
import { runWithHistory } from "../history.js";
import { refresh } from "./view-actions.js";
import { normalizeStringList } from "../workspace-normalizer.js";

export function saveCoverageRequirements(requirements) {
  runWithHistory("必要人数の設定を変更", () => setCoverageRequirements(requirements));
  refresh();
}

export function saveStaffingSettings({ requirements, qualificationUpdates = [] }) {
  runWithHistory("配置条件と資格を変更", () => {
    for (const update of qualificationUpdates) {
      const employee = state.employees.find((item) => item.id === update.employeeId);
      if (employee) employee.qualifications = normalizeStringList(update.qualifications);
    }
    setCoverageRequirements(requirements, { save: false });
    scheduleSave();
  });
  refresh();
}
