import { dateKey, getDaysInMonth } from "./date-time.js";
import { overtimeMinutesForShift } from "./shift-metrics.js";
import { isShiftLockedInData } from "./shift-locks.js";
import {
  availableWorkShiftCodes,
  normalizeAvoidLateEarly,
  normalizePreferredShiftCode
} from "./work-shift-preferences.js";
import {
  COVERAGE_SLOT_COUNT,
  addShiftCoverage,
  chooseBestShift,
  dominantShiftCode,
  validWorkShiftTypes
} from "./work-shift-planner-core.js";

const VALID_MODES = new Set(["empty-only", "replace-unlocked-work"]);

function shiftCodeAt(shifts, monthValue, employeeId, day) {
  return shifts?.[monthValue]?.[employeeId]?.[dateKey(monthValue, day)] ?? "";
}

function employeeDayMap(container, employeeId) {
  if (!container.has(employeeId)) container.set(employeeId, new Map());
  return container.get(employeeId);
}

function addCount(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function addPreservedWork(context, employeeId, day, shiftType) {
  employeeDayMap(context.plannedCodes, employeeId).set(day, shiftType.code);
  addShiftCoverage(context.dailyCoverage[day], shiftType);
  addCount(context.dailyShiftCounts[day], shiftType.code);
  addCount(context.employeeShiftCounts.get(employeeId), shiftType.code);
  context.employeeOvertime.set(
    employeeId,
    context.employeeOvertime.get(employeeId) + overtimeMinutesForShift(shiftType)
  );
}

function plannedShift(context, employeeId, day) {
  const code = context.plannedCodes.get(employeeId)?.get(day) ?? "";
  return context.typeMap.get(code) ?? null;
}

function employeeCandidates(employee, selectedWorkTypes) {
  const allowed = new Set(availableWorkShiftCodes(employee, selectedWorkTypes));
  return selectedWorkTypes.filter((shiftType) => allowed.has(shiftType.code));
}

function createEmployeeResult(employee, candidates, dominantCode) {
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    allowedShiftCount: candidates.length,
    preferredShiftCode: normalizePreferredShiftCode(employee.preferredShiftCode),
    dominantShiftCode: dominantCode,
    eligibleCells: 0,
    assignedCells: 0,
    changedCells: 0,
    projectedOvertimeMinutes: 0,
    fixedOvertimeMinutes: Number(employee.fixedOvertimeMinutes) || 0,
    warnings: []
  };
}

export function buildWorkShiftPlan(options) {
  const monthValue = String(options?.monthValue ?? "");
  const mode = VALID_MODES.has(options?.mode) ? options.mode : "empty-only";
  const employees = Array.isArray(options?.employees) ? [...options.employees] : [];
  const shifts = options?.shifts ?? {};
  const shiftLocks = options?.shiftLocks ?? {};
  const allWorkTypes = validWorkShiftTypes(options?.shiftTypes);
  const selectedCodes = new Set(Array.isArray(options?.selectedShiftCodes) ? options.selectedShiftCodes : []);
  const selectedWorkTypes = allWorkTypes.filter((shiftType) => selectedCodes.size === 0 || selectedCodes.has(shiftType.code));
  if (!selectedWorkTypes.length) throw new Error("自動割当に使う勤務シフトを1つ以上選択してください。");

  const daysInMonth = getDaysInMonth(monthValue);
  const typeMap = new Map((Array.isArray(options?.shiftTypes) ? options.shiftTypes : []).map((shiftType) => [shiftType.code, shiftType]));
  const context = {
    typeMap,
    plannedCodes: new Map(),
    dailyCoverage: Array.from({ length: daysInMonth + 1 }, () => Array(COVERAGE_SLOT_COUNT).fill(0)),
    dailyShiftCounts: Array.from({ length: daysInMonth + 1 }, () => new Map()),
    employeeShiftCounts: new Map(),
    employeeOvertime: new Map()
  };

  employees.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.name).localeCompare(String(b.name), "ja"));
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const candidateMap = new Map();
  const originalWorkCodes = new Map();
  const resultMap = new Map();
  const targetsByDay = Array.from({ length: daysInMonth + 1 }, () => []);
  let preservedLocked = 0;
  let preservedNonWork = 0;
  let preservedExistingWork = 0;

  for (const employee of employees) {
    const candidates = employeeCandidates(employee, selectedWorkTypes);
    candidateMap.set(employee.id, candidates);
    context.employeeShiftCounts.set(employee.id, new Map());
    context.employeeOvertime.set(employee.id, 0);
    originalWorkCodes.set(employee.id, []);

    for (let day = 1; day <= daysInMonth; day += 1) {
      const code = shiftCodeAt(shifts, monthValue, employee.id, day);
      const shiftType = typeMap.get(code);
      const locked = isShiftLockedInData(shiftLocks, monthValue, employee.id, dateKey(monthValue, day));
      if (shiftType?.isWork) originalWorkCodes.get(employee.id).push(code);

      if (shiftType && !shiftType.isWork) {
        employeeDayMap(context.plannedCodes, employee.id).set(day, code);
        preservedNonWork += 1;
        continue;
      }
      if (locked) {
        if (shiftType?.isWork) addPreservedWork(context, employee.id, day, shiftType);
        else employeeDayMap(context.plannedCodes, employee.id).set(day, code);
        preservedLocked += 1;
        continue;
      }
      if (mode === "empty-only" && shiftType?.isWork) {
        addPreservedWork(context, employee.id, day, shiftType);
        preservedExistingWork += 1;
        continue;
      }
      if (!code || shiftType?.isWork) {
        targetsByDay[day].push({ employeeId: employee.id, employeeName: employee.name, day, before: code });
      }
    }

    const dominantCode = dominantShiftCode(originalWorkCodes.get(employee.id), candidates.map((item) => item.code));
    resultMap.set(employee.id, createEmployeeResult(employee, candidates, dominantCode));
    if (!candidates.length) resultMap.get(employee.id).warnings.push("使用可能な勤務シフトが選択候補と一致しません。対象セルは変更しません。");
  }

  const changes = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    targetsByDay[day].sort((a, b) =>
      candidateMap.get(a.employeeId).length - candidateMap.get(b.employeeId).length
      || Number(employeeById.get(a.employeeId)?.order ?? 0) - Number(employeeById.get(b.employeeId)?.order ?? 0)
    );

    for (const target of targetsByDay[day]) {
      const employee = employeeById.get(target.employeeId);
      const result = resultMap.get(target.employeeId);
      const candidates = candidateMap.get(target.employeeId);
      result.eligibleCells += 1;
      if (!candidates.length) continue;

      const previousShift = day > 1 ? plannedShift(context, target.employeeId, day - 1) : null;
      const nextShift = day < daysInMonth ? plannedShift(context, target.employeeId, day + 1) : null;
      const choice = chooseBestShift(candidates, {
        coverage: context.dailyCoverage[day],
        dayShiftCounts: context.dailyShiftCounts[day],
        employeeShiftCounts: context.employeeShiftCounts.get(target.employeeId),
        preferredShiftCode: normalizePreferredShiftCode(employee.preferredShiftCode),
        dominantShiftCode: result.dominantShiftCode,
        previousShift,
        nextShift,
        currentOvertimeMinutes: context.employeeOvertime.get(target.employeeId),
        fixedOvertimeMinutes: Number(employee.fixedOvertimeMinutes) || 0,
        avoidLateEarly: normalizeAvoidLateEarly(employee.avoidLateEarly)
      });
      if (!choice) continue;

      employeeDayMap(context.plannedCodes, target.employeeId).set(day, choice.candidate.code);
      addShiftCoverage(context.dailyCoverage[day], choice.candidate);
      addCount(context.dailyShiftCounts[day], choice.candidate.code);
      addCount(context.employeeShiftCounts.get(target.employeeId), choice.candidate.code);
      context.employeeOvertime.set(target.employeeId, choice.projectedOvertime);
      result.assignedCells += 1;

      if (target.before !== choice.candidate.code) {
        changes.push({
          employeeId: target.employeeId,
          employeeName: target.employeeName,
          day,
          before: target.before,
          after: choice.candidate.code,
          kind: target.before ? "reassign" : "place"
        });
        result.changedCells += 1;
      }
      if (choice.previousShortRest || choice.nextShortRest) {
        result.warnings.push(`${day}日は候補の制約上、前後いずれかの勤務間隔が11時間未満です。`);
      }
    }
  }

  for (const employee of employees) {
    const result = resultMap.get(employee.id);
    result.projectedOvertimeMinutes = context.employeeOvertime.get(employee.id);
    if (result.assignedCells < result.eligibleCells && result.allowedShiftCount > 0) {
      result.warnings.push(`${result.eligibleCells - result.assignedCells}セルへ勤務シフトを割り当てられませんでした。`);
    }
    if (result.projectedOvertimeMinutes > result.fixedOvertimeMinutes) {
      const excess = result.projectedOvertimeMinutes - result.fixedOvertimeMinutes;
      result.warnings.push(`残業見込みが固定残業枠を${Math.round(excess / 6) / 10}時間超えます。`);
    }
  }

  const employeeResults = employees.map((employee) => resultMap.get(employee.id));
  const warnings = employeeResults.flatMap((result) =>
    result.warnings.map((message) => `${result.employeeName}: ${message}`)
  );
  return {
    monthValue,
    mode,
    selectedShiftCodes: selectedWorkTypes.map((shiftType) => shiftType.code),
    changes,
    employeeResults,
    warnings,
    summary: {
      employees: employees.length,
      eligibleCells: employeeResults.reduce((sum, result) => sum + result.eligibleCells, 0),
      assignedCells: employeeResults.reduce((sum, result) => sum + result.assignedCells, 0),
      placed: changes.filter((change) => change.kind === "place").length,
      reassigned: changes.filter((change) => change.kind === "reassign").length,
      unchanged: employeeResults.reduce((sum, result) => sum + result.assignedCells - result.changedCells, 0),
      preservedLocked,
      preservedNonWork,
      preservedExistingWork,
      overtimeExceededEmployees: employeeResults.filter((result) => result.projectedOvertimeMinutes > result.fixedOvertimeMinutes).length,
      warningCount: warnings.length
    }
  };
}
