import { plannedBreakTemplates } from "./break-rules.js";

export function generateGreedyRestPlan(dayPlan) {
  const employees = Array.isArray(dayPlan?.employees) ? dayPlan.employees : [];
  const result = {};
  for (const employee of employees) result[employee.id] = plannedBreakTemplates(0);
  return result;
}
