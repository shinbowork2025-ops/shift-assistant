import { getDaysInMonth } from "./date-time.js";
import { createShiftTypeMap, createInitialOffCounts } from "./days-off-planner-core.js";
import { planEmployeeDaysOff } from "./employee-days-off-plan.js";

const VALID_MODES = new Set(["empty-only", "replace-unlocked"]);

export function findDefaultDaysOffShiftCode(shiftTypes) {
  const nonWork = (Array.isArray(shiftTypes) ? shiftTypes : []).filter((shiftType) => !shiftType.isWork);
  const preferred = nonWork.find((shiftType) => shiftType.code === "7")
    ?? nonWork.find((shiftType) => /公休/.test(shiftType.name))
    ?? nonWork.find((shiftType) => /休日|休/.test(shiftType.name))
    ?? nonWork.find((shiftType) => shiftType.code === "off")
    ?? nonWork[0];
  return preferred?.code ?? "";
}

export function buildDaysOffPlan(options) {
  const monthValue = String(options?.monthValue ?? "");
  const employees = Array.isArray(options?.employees) ? [...options.employees] : [];
  const shiftTypes = Array.isArray(options?.shiftTypes) ? options.shiftTypes : [];
  const shifts = options?.shifts ?? {};
  const shiftLocks = options?.shiftLocks ?? {};
  const offShiftCode = String(options?.offShiftCode ?? "");
  const mode = VALID_MODES.has(options?.mode) ? options.mode : "empty-only";
  const daysInMonth = getDaysInMonth(monthValue);
  const typeMap = createShiftTypeMap(shiftTypes);
  const offShiftType = typeMap.get(offShiftCode);
  if (!offShiftCode || !offShiftType || offShiftType.isWork) {
    throw new Error("公休として配置する休日区分を選択してください。");
  }

  employees.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.name).localeCompare(String(b.name), "ja"));
  const dailyOffCounts = createInitialOffCounts({
    monthValue,
    daysInMonth,
    employees,
    shifts,
    shiftLocks,
    typeMap,
    offShiftCode,
    mode
  });
  const changes = [];
  const employeeResults = [];

  employees.forEach((employee, employeeIndex) => {
    const planned = planEmployeeDaysOff({
      monthValue,
      daysInMonth,
      employee,
      employeeIndex,
      shifts,
      shiftLocks,
      typeMap,
      offShiftCode,
      mode,
      dailyOffCounts
    });
    changes.push(...planned.changes);
    employeeResults.push(planned.result);
  });

  const warnings = employeeResults.flatMap((result) =>
    result.warnings.map((message) => `${result.employeeName}: ${message}`)
  );
  return {
    monthValue,
    mode,
    offShiftCode,
    offShiftName: offShiftType.name,
    changes,
    employeeResults,
    warnings,
    summary: {
      employees: employees.length,
      processedEmployees: employeeResults.filter((result) => !result.skipped).length,
      skippedEmployees: employeeResults.filter((result) => result.skipped).length,
      placed: changes.filter((change) => change.kind === "place").length,
      overwritten: changes.filter((change) => change.kind === "overwrite").length,
      cleared: changes.filter((change) => change.kind === "clear").length,
      warningCount: warnings.length
    }
  };
}
