import { dateKey, getDayInfo, getDaysInMonth, timeToMinutes } from "./date-time.js";
import { EMPLOYMENT_TYPES, normalizeEmploymentType } from "./employment-types.js";
import { activeRequirementsForWeekday } from "./coverage-requirements.js";
import { overtimeMinutesForShift } from "./shift-metrics.js";
import { isShiftLockedInData } from "./shift-locks.js";
import {
  availableWorkShiftCodes,
  normalizeAvoidLateEarly,
  normalizePreferredShiftCode
} from "./work-shift-preferences.js";
import {
  COVERAGE_SLOT_COUNT,
  COVERAGE_SLOT_MINUTES,
  addShiftCoverage,
  chooseBestShift,
  dominantShiftCode,
  hasShortRest,
  shiftSlotIndexes,
  validWorkShiftTypes
} from "./work-shift-planner-core.js";

const VALID_MODES = new Set(["empty-only", "replace-unlocked-work", "optimize-unlocked-work"]);
const DEFAULT_SOLVER_PASSES = 4;

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

function zeroByType() {
  return Object.fromEntries(EMPLOYMENT_TYPES.map((type) => [type.code, 0]));
}

function slotOverlapsRequirement(slotStart, requirementStart, requirementEnd) {
  const slotEnd = slotStart + COVERAGE_SLOT_MINUTES;
  return slotStart < requirementEnd && slotEnd > requirementStart;
}

function plannedCode(context, employeeId, day) {
  return context.plannedCodes.get(employeeId)?.get(day) ?? "";
}

function plannedShift(context, employeeId, day) {
  const code = plannedCode(context, employeeId, day);
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

function buildRequiredCoverage({ monthValue, daysInMonth, coverageRequirements }) {
  const total = Array.from({ length: daysInMonth + 1 }, () => Array(COVERAGE_SLOT_COUNT).fill(0));
  const byType = Array.from({ length: daysInMonth + 1 }, () => (
    Object.fromEntries(EMPLOYMENT_TYPES.map((type) => [type.code, Array(COVERAGE_SLOT_COUNT).fill(0)]))
  ));
  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekday = getDayInfo(monthValue, day).weekday;
    const active = activeRequirementsForWeekday(coverageRequirements, weekday);
    for (const requirement of active) {
      const start = timeToMinutes(requirement.start);
      const end = timeToMinutes(requirement.end);
      if (start === null || end === null || end <= start) continue;
      for (let slot = 0; slot < COVERAGE_SLOT_COUNT; slot += 1) {
        const slotStart = slot * COVERAGE_SLOT_MINUTES;
        if (!slotOverlapsRequirement(slotStart, start, end)) continue;
        total[day][slot] = Math.max(total[day][slot], requirement.requiredTotal);
        for (const type of EMPLOYMENT_TYPES) {
          byType[day][type.code][slot] = Math.max(
            byType[day][type.code][slot],
            requirement.requiredByType[type.code] ?? 0
          );
        }
      }
    }
  }
  return { total, byType };
}

function buildCoverageSnapshot(context, employees, daysInMonth) {
  const total = Array.from({ length: daysInMonth + 1 }, () => Array(COVERAGE_SLOT_COUNT).fill(0));
  const byType = Array.from({ length: daysInMonth + 1 }, () => (
    Object.fromEntries(EMPLOYMENT_TYPES.map((type) => [type.code, Array(COVERAGE_SLOT_COUNT).fill(0)]))
  ));
  for (const employee of employees) {
    const employmentType = normalizeEmploymentType(employee.employmentType);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const shiftType = plannedShift(context, employee.id, day);
      if (!shiftType?.isWork) continue;
      for (const slot of shiftSlotIndexes(shiftType)) {
        total[day][slot] += 1;
        byType[day][employmentType][slot] += 1;
      }
    }
  }
  return { total, byType };
}

function variance(values) {
  if (!values.length) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
}

function evaluateSolverScore(context, employees, daysInMonth, requiredCoverage, candidateCodesByEmployee) {
  const coverage = buildCoverageSnapshot(context, employees, daysInMonth);
  let shortagePenalty = 0;
  let shortageSlotCount = 0;
  let maxTotalShort = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    for (let slot = 0; slot < COVERAGE_SLOT_COUNT; slot += 1) {
      const totalShort = Math.max(0, requiredCoverage.total[day][slot] - coverage.total[day][slot]);
      if (totalShort > 0) {
        shortageSlotCount += 1;
        maxTotalShort = Math.max(maxTotalShort, totalShort);
        shortagePenalty += totalShort * totalShort * 100000;
      }
      for (const type of EMPLOYMENT_TYPES) {
        const typeShort = Math.max(0, requiredCoverage.byType[day][type.code][slot] - coverage.byType[day][type.code][slot]);
        if (typeShort > 0) shortagePenalty += typeShort * typeShort * 60000;
      }
    }
  }

  let hardPenalty = 0;
  let overtimePenalty = 0;
  let preferencePenalty = 0;
  const daysOffCounts = [];
  const lateCounts = [];
  const shiftVariancePieces = [];
  for (const employee of employees) {
    let consecutive = 0;
    let daysOff = 0;
    let overtime = 0;
    let lateCount = 0;
    const shiftCounts = new Map();
    const preferred = normalizePreferredShiftCode(employee.preferredShiftCode);
    const fixedOvertime = Number(employee.fixedOvertimeMinutes) || 0;
    const candidateCodes = candidateCodesByEmployee.get(employee.id) ?? [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const shiftType = plannedShift(context, employee.id, day);
      if (shiftType?.isWork) {
        consecutive += 1;
        if (consecutive > 6) hardPenalty += (consecutive - 6) * (consecutive - 6) * 40000;
        overtime += overtimeMinutesForShift(shiftType);
        addCount(shiftCounts, shiftType.code);
        const end = timeToMinutes(shiftType.end) ?? 0;
        if (end >= 20 * 60) lateCount += 1;
        if (preferred && preferred !== shiftType.code) preferencePenalty += 24;
        const nextShift = day < daysInMonth ? plannedShift(context, employee.id, day + 1) : null;
        if (normalizeAvoidLateEarly(employee.avoidLateEarly) && hasShortRest(shiftType, nextShift)) hardPenalty += 50000;
      } else {
        consecutive = 0;
        daysOff += 1;
      }
    }
    const excess = Math.max(0, overtime - fixedOvertime);
    overtimePenalty += excess * excess * 0.6;
    daysOffCounts.push(daysOff);
    lateCounts.push(lateCount);
    if (candidateCodes.length > 1) {
      shiftVariancePieces.push(variance(candidateCodes.map((code) => shiftCounts.get(code) ?? 0)));
    }
  }

  const fairnessPenalty = variance(daysOffCounts) * 120
    + variance(lateCounts) * 80
    + shiftVariancePieces.reduce((sum, value) => sum + value, 0) * 18;

  return {
    total: shortagePenalty + hardPenalty + overtimePenalty + fairnessPenalty + preferencePenalty,
    shortagePenalty,
    hardPenalty,
    overtimePenalty,
    fairnessPenalty,
    preferencePenalty,
    shortageSlotCount,
    maxTotalShort
  };
}

function setPlannedCode(context, employeeId, day, code) {
  employeeDayMap(context.plannedCodes, employeeId).set(day, code);
}

function tryMove(context, employees, daysInMonth, requiredCoverage, candidateCodesByEmployee, bestScore, changes) {
  const beforeValues = changes.map((change) => ({ ...change, code: plannedCode(context, change.employeeId, change.day) }));
  for (const change of changes) setPlannedCode(context, change.employeeId, change.day, change.after);
  const score = evaluateSolverScore(context, employees, daysInMonth, requiredCoverage, candidateCodesByEmployee);
  if (score.total < bestScore.total - 0.0001) return { improved: true, score };
  for (const change of beforeValues) setPlannedCode(context, change.employeeId, change.day, change.code);
  return { improved: false, score: bestScore };
}

function optimizeMonth(context, { employees, daysInMonth, mutableTargets, candidateMap, coverageRequirements }) {
  const requiredCoverage = buildRequiredCoverage({ monthValue: context.monthValue, daysInMonth, coverageRequirements });
  const candidateCodesByEmployee = new Map(
    employees.map((employee) => [employee.id, (candidateMap.get(employee.id) ?? []).map((shiftType) => shiftType.code)])
  );
  let bestScore = evaluateSolverScore(context, employees, daysInMonth, requiredCoverage, candidateCodesByEmployee);
  const initialScore = bestScore;
  let iterations = 0;
  let improvements = 0;

  for (let pass = 0; pass < DEFAULT_SOLVER_PASSES; pass += 1) {
    let improvedThisPass = false;
    for (const target of mutableTargets) {
      const current = plannedCode(context, target.employeeId, target.day);
      for (const candidate of candidateMap.get(target.employeeId) ?? []) {
        if (candidate.code === current) continue;
        iterations += 1;
        const result = tryMove(context, employees, daysInMonth, requiredCoverage, candidateCodesByEmployee, bestScore, [
          { employeeId: target.employeeId, day: target.day, after: candidate.code }
        ]);
        if (result.improved) {
          bestScore = result.score;
          improvements += 1;
          improvedThisPass = true;
        }
      }
    }

    const byDay = new Map();
    for (const target of mutableTargets) {
      if (!byDay.has(target.day)) byDay.set(target.day, []);
      byDay.get(target.day).push(target);
    }
    for (const targets of byDay.values()) {
      for (let left = 0; left < targets.length; left += 1) {
        for (let right = left + 1; right < targets.length; right += 1) {
          const a = targets[left];
          const b = targets[right];
          const aCode = plannedCode(context, a.employeeId, a.day);
          const bCode = plannedCode(context, b.employeeId, b.day);
          if (!aCode || !bCode || aCode === bCode) continue;
          if (!(candidateCodesByEmployee.get(a.employeeId) ?? []).includes(bCode)) continue;
          if (!(candidateCodesByEmployee.get(b.employeeId) ?? []).includes(aCode)) continue;
          iterations += 1;
          const result = tryMove(context, employees, daysInMonth, requiredCoverage, candidateCodesByEmployee, bestScore, [
            { employeeId: a.employeeId, day: a.day, after: bCode },
            { employeeId: b.employeeId, day: b.day, after: aCode }
          ]);
          if (result.improved) {
            bestScore = result.score;
            improvements += 1;
            improvedThisPass = true;
          }
        }
      }
    }
    if (!improvedThisPass) break;
  }

  return { initialScore, finalScore: bestScore, iterations, improvements };
}

function rebuildCoverageCounters(context, employees, daysInMonth) {
  context.dailyCoverage = Array.from({ length: daysInMonth + 1 }, () => Array(COVERAGE_SLOT_COUNT).fill(0));
  context.dailyShiftCounts = Array.from({ length: daysInMonth + 1 }, () => new Map());
  context.employeeShiftCounts = new Map();
  context.employeeOvertime = new Map();
  for (const employee of employees) {
    context.employeeShiftCounts.set(employee.id, new Map());
    context.employeeOvertime.set(employee.id, 0);
  }
  for (const employee of employees) {
    for (let day = 1; day <= daysInMonth; day += 1) {
      const shiftType = plannedShift(context, employee.id, day);
      if (!shiftType?.isWork) continue;
      addShiftCoverage(context.dailyCoverage[day], shiftType);
      addCount(context.dailyShiftCounts[day], shiftType.code);
      addCount(context.employeeShiftCounts.get(employee.id), shiftType.code);
      context.employeeOvertime.set(employee.id, context.employeeOvertime.get(employee.id) + overtimeMinutesForShift(shiftType));
    }
  }
}

function finalizePlan({ context, employees, daysInMonth, candidateMap, resultMap, mutableTargets, coverageRequirements, mode, selectedWorkTypes, preservedLocked, preservedNonWork, preservedExistingWork, solver }) {
  rebuildCoverageCounters(context, employees, daysInMonth);
  const changes = [];
  for (const employee of employees) {
    const candidates = candidateMap.get(employee.id) ?? [];
    const result = resultMap.get(employee.id);
    const previousWarnings = result.warnings.filter((message) => message.includes("使用可能"));
    Object.assign(result, createEmployeeResult(employee, candidates, result.dominantShiftCode));
    result.warnings = [...previousWarnings];
    result.projectedOvertimeMinutes = context.employeeOvertime.get(employee.id) ?? 0;
  }

  for (const target of mutableTargets) {
    const result = resultMap.get(target.employeeId);
    const after = plannedCode(context, target.employeeId, target.day);
    result.eligibleCells += 1;
    if (after) result.assignedCells += 1;
    if (target.before !== after) {
      changes.push({
        employeeId: target.employeeId,
        employeeName: target.employeeName,
        day: target.day,
        before: target.before,
        after,
        kind: target.before ? "reassign" : "place"
      });
      result.changedCells += 1;
    }
  }

  for (const employee of employees) {
    const result = resultMap.get(employee.id);
    if (result.assignedCells < result.eligibleCells && result.allowedShiftCount > 0) {
      result.warnings.push(`${result.eligibleCells - result.assignedCells}セルへ勤務シフトを割り当てられませんでした。`);
    }
    if (result.projectedOvertimeMinutes > result.fixedOvertimeMinutes) {
      const excess = result.projectedOvertimeMinutes - result.fixedOvertimeMinutes;
      result.warnings.push(`残業見込みが固定残業枠を${Math.round(excess / 6) / 10}時間超えます。`);
    }
    for (let day = 1; day < daysInMonth; day += 1) {
      const current = plannedShift(context, employee.id, day);
      const next = plannedShift(context, employee.id, day + 1);
      if (current?.isWork && next?.isWork && normalizeAvoidLateEarly(employee.avoidLateEarly) && hasShortRest(current, next)) {
        result.warnings.push(`${day}日から${day + 1}日にかけて勤務間隔が11時間未満です。`);
      }
    }
  }

  const requiredCoverage = buildRequiredCoverage({ monthValue: context.monthValue, daysInMonth, coverageRequirements });
  const finalScore = evaluateSolverScore(context, employees, daysInMonth, requiredCoverage, new Map(
    employees.map((employee) => [employee.id, (candidateMap.get(employee.id) ?? []).map((shiftType) => shiftType.code)])
  ));
  const employeeResults = employees.map((employee) => resultMap.get(employee.id));
  const warnings = employeeResults.flatMap((result) =>
    result.warnings.map((message) => `${result.employeeName}: ${message}`)
  );
  return {
    monthValue: context.monthValue,
    mode,
    selectedShiftCodes: selectedWorkTypes.map((shiftType) => shiftType.code),
    changes,
    employeeResults,
    warnings,
    solver: solver ? { ...solver, finalScore } : null,
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
      shortageSlotCount: finalScore.shortageSlotCount,
      maxTotalShort: finalScore.maxTotalShort,
      overtimeExceededEmployees: employeeResults.filter((result) => result.projectedOvertimeMinutes > result.fixedOvertimeMinutes).length,
      warningCount: warnings.length
    }
  };
}

export function buildWorkShiftPlan(options) {
  const monthValue = String(options?.monthValue ?? "");
  const mode = VALID_MODES.has(options?.mode) ? options.mode : "empty-only";
  const employees = Array.isArray(options?.employees) ? [...options.employees] : [];
  const shifts = options?.shifts ?? {};
  const shiftLocks = options?.shiftLocks ?? {};
  const coverageRequirements = options?.coverageRequirements ?? [];
  const allWorkTypes = validWorkShiftTypes(options?.shiftTypes);
  const selectedCodes = new Set(Array.isArray(options?.selectedShiftCodes) ? options.selectedShiftCodes : []);
  const selectedWorkTypes = allWorkTypes.filter((shiftType) => selectedCodes.size === 0 || selectedCodes.has(shiftType.code));
  if (!selectedWorkTypes.length) throw new Error("自動割当に使う勤務シフトを1つ以上選択してください。");

  const daysInMonth = getDaysInMonth(monthValue);
  const typeMap = new Map((Array.isArray(options?.shiftTypes) ? options.shiftTypes : []).map((shiftType) => [shiftType.code, shiftType]));
  const context = {
    monthValue,
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
  const mutableTargets = [];
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
        const target = { employeeId: employee.id, employeeName: employee.name, day, before: code };
        targetsByDay[day].push(target);
        mutableTargets.push(target);
      }
    }

    const dominantCode = dominantShiftCode(originalWorkCodes.get(employee.id), candidates.map((item) => item.code));
    resultMap.set(employee.id, createEmployeeResult(employee, candidates, dominantCode));
    if (!candidates.length) resultMap.get(employee.id).warnings.push("使用可能な勤務シフトが選択候補と一致しません。対象セルは変更しません。");
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    targetsByDay[day].sort((a, b) =>
      candidateMap.get(a.employeeId).length - candidateMap.get(b.employeeId).length
      || Number(employeeById.get(a.employeeId)?.order ?? 0) - Number(employeeById.get(b.employeeId)?.order ?? 0)
    );

    for (const target of targetsByDay[day]) {
      const employee = employeeById.get(target.employeeId);
      const candidates = candidateMap.get(target.employeeId);
      if (!candidates.length) continue;

      const previousShift = day > 1 ? plannedShift(context, target.employeeId, day - 1) : null;
      const nextShift = day < daysInMonth ? plannedShift(context, target.employeeId, day + 1) : null;
      const choice = chooseBestShift(candidates, {
        coverage: context.dailyCoverage[day],
        dayShiftCounts: context.dailyShiftCounts[day],
        employeeShiftCounts: context.employeeShiftCounts.get(target.employeeId),
        preferredShiftCode: normalizePreferredShiftCode(employee.preferredShiftCode),
        dominantShiftCode: resultMap.get(target.employeeId).dominantShiftCode,
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
    }
  }

  const solver = mode === "optimize-unlocked-work"
    ? optimizeMonth(context, { employees, daysInMonth, mutableTargets, candidateMap, coverageRequirements })
    : null;

  return finalizePlan({
    context,
    employees,
    daysInMonth,
    candidateMap,
    resultMap,
    mutableTargets,
    coverageRequirements,
    mode,
    selectedWorkTypes,
    preservedLocked,
    preservedNonWork,
    preservedExistingWork,
    solver
  });
}
