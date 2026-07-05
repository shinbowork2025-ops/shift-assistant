import { dayFromDate, minutesToTime, timeToMinutes } from "./date-time.js";
import { buildShiftTypeMap, getShiftCodeFromData } from "./month-overview.js";
import { generateGreedyRestPlan } from "./rest-greedy.js";

export function buildOptimizerInput() {
  return { employees: [] };
}

export function formatOptimizerOutput() {
  return {};
}
