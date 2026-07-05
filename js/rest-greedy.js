import { plannedBreakTemplates } from "./break-rules.js";
import { breakSlots, nearbyStarts } from "./break-grid.js";

export function generateGreedyRestPlan(dayPlan) {
  const employees = Array.isArray(dayPlan?.employees) ? dayPlan.employees : [];
  const result = {};
  for (const employee of employees) {
    result[employee.id] = breakSlots(0, 0).concat(nearbyStarts(0, 0, 0), plannedBreakTemplates(0));
  }
  return result;
}
