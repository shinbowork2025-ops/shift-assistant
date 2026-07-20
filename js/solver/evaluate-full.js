import {
  SOLVER_CONFIG_VERSION,
  normalizeSolverWeights
} from "./solver-config.js";
import { evaluateEstimatedCoverageForDay } from "./coverage-evaluation.js";
import { overtimeMinutes } from "./time-slots.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function asMap(value, key = "id") {
  if (value instanceof Map) return value;
  if (Array.isArray(value)) return new Map(value.map((item) => [item?.[key], item]));
  return new Map(Object.entries(value && typeof value === "object" ? value : {}));
}

function parseMinute(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : null;
}

function normalizeShiftType(shiftType) {
  if (!shiftType) return null;
  const isDayOff = Boolean(shiftType.isDayOff ?? shiftType.isWork === false);
  return {
    ...shiftType,
    isDayOff,
    startMinutes: isDayOff ? null : parseMinute(shiftType.startMinutes ?? shiftType.start),
    endMinutes: isDayOff ? null : parseMinute(shiftType.endMinutes ?? shiftType.end),
    overtimeMinutes: overtimeMinutes(shiftType)
  };
}

function dateAt(periodStart, day) {
  const base = new Date(`${periodStart}T00:00:00.000Z`);
  return new Date(base.getTime() + day * DAY_MS);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function assignment(plan, employeeIndex, day) {
  return plan.assignments?.[employeeIndex]?.[day] ?? null;
}

function populationVariance(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
}

function addViolation(target, layer, type, employee, days, amount, message) {
  target.push({
    layer,
    type,
    ...(employee ? { employeeId: employee.id } : {}),
    days: [...new Set(days)].sort((a, b) => a - b),
    amount,
    message
  });
}

function statutoryCycleStarts(plan, settings) {
  const first = dateAt(plan.periodStart, 0);
  const last = dateAt(plan.periodStart, plan.dayCount - 1);
  if (settings.statutoryHolidayRule === "fourWeek") {
    const anchor = new Date(`${settings.fourWeekCycleStartDate}T00:00:00.000Z`);
    if (Number.isNaN(anchor.getTime())) return [];
    const offset = Math.floor((first.getTime() - anchor.getTime()) / DAY_MS);
    const cycleNumber = Math.floor(offset / 28);
    const starts = [];
    for (let start = new Date(anchor.getTime() + cycleNumber * 28 * DAY_MS); start <= last; start = new Date(start.getTime() + 28 * DAY_MS)) {
      starts.push(start);
    }
    return starts.map((start) => ({ start, length: 28, required: 4 }));
  }
  const weekStartDay = Number.isInteger(Number(settings.weekStartDay)) ? Number(settings.weekStartDay) : 1;
  const back = (first.getUTCDay() - weekStartDay + 7) % 7;
  const firstCycle = new Date(first.getTime() - back * DAY_MS);
  const starts = [];
  for (let start = firstCycle; start <= last; start = new Date(start.getTime() + 7 * DAY_MS)) {
    starts.push({ start, length: 7, required: 1 });
  }
  return starts;
}

function boundaryCode(settings, side, employeeId) {
  const direct = settings?.[`${side}Assignments`];
  if (direct instanceof Map) return direct.get(employeeId) ?? null;
  if (direct && typeof direct === "object") return direct[employeeId] ?? null;
  const nested = settings?.boundaryAssignments?.[employeeId];
  return nested?.[`${side}Code`] ?? null;
}

function createBreakdown(employeeOrder) {
  return Object.fromEntries(employeeOrder.map((employeeId) => [employeeId, {
    daysOff: 0,
    maxConsecutiveWorkDays: 0,
    overtimeMinutes: 0,
    overtimeExcessMinutes: 0,
    weekendWorkDays: 0,
    lateShiftDays: 0
  }]));
}

export function evaluatePlanFull(plan, context) {
  const shiftTypes = new Map([...asMap(context?.shiftTypes, "code")].map(([code, value]) => [code, normalizeShiftType(value)]));
  const employees = asMap(context?.employees);
  const settings = context?.settings && typeof context.settings === "object" ? context.settings : {};
  const weights = normalizeSolverWeights(settings.weights);
  const preferences = Array.isArray(context?.preferences) ? context.preferences : [];
  const employeeOrder = Array.isArray(plan?.employeeOrder) ? plan.employeeOrder : [];
  const employeeIndex = new Map(employeeOrder.map((employeeId, index) => [employeeId, index]));
  const violations = [];
  const verificationIssues = [];
  const breakdownByEmployee = createBreakdown(employeeOrder);

  let statutoryPenalty = 0;
  let internalPenalty = 0;
  let coveragePenalty = 0;
  let overtimePenalty = 0;
  let preferencePenalty = 0;
  let fairnessPenalty = 0;
  let changePenalty = 0;
  let statutoryViolationCount = 0;
  let statutoryViolationAmount = 0;
  let internalViolationCount = 0;
  let internalViolationAmount = 0;
  let preferenceViolationCount = 0;
  let preferenceViolationAmount = 0;

  const previousKnown = settings.previousBoundaryKnown !== false;
  const nextKnown = settings.nextBoundaryKnown !== false;
  if (!previousKnown) {
    verificationIssues.push({
      type: "prevBoundaryUnknown:consecutive",
      message: "前月末の勤務情報がないため、月初の連続勤務は未確認"
    });
    verificationIssues.push({
      type: "prevBoundaryUnknown:restInterval",
      message: "前月末の勤務情報がないため、月初の勤務間隔は未確認"
    });
  }
  if (!nextKnown) {
    verificationIssues.push({
      type: "nextBoundaryUnknown:consecutive",
      message: "翌月初の勤務情報がないため、月末の連続勤務は未確認"
    });
    verificationIssues.push({
      type: "nextBoundaryUnknown:restInterval",
      message: "翌月初の勤務情報がないため、月末の勤務間隔は未確認"
    });
  }

  const statutoryCodes = new Set(settings.statutoryHolidayCodes ?? []);
  if (settings.statutoryHolidayRule !== "disabled") {
    let incompleteCycle = false;
    const periodStartDate = dateAt(plan.periodStart, 0);
    const periodEndDate = dateAt(plan.periodStart, plan.dayCount - 1);
    for (const cycle of statutoryCycleStarts(plan, settings)) {
      const cycleEnd = new Date(cycle.start.getTime() + (cycle.length - 1) * DAY_MS);
      const extendsPrevious = cycle.start < periodStartDate;
      const extendsNext = cycleEnd > periodEndDate;
      // A single adjacent-day code is enough for rest-interval checks, but not for
      // counting every statutory holiday in a partial 7/28-day cycle. Treat all
      // cross-period cycles as unverified until the evaluation contract carries
      // the complete adjacent-cycle assignments.
      if (extendsPrevious || extendsNext) {
        incompleteCycle = true;
        continue;
      }
      const firstDay = Math.max(0, Math.round((cycle.start.getTime() - periodStartDate.getTime()) / DAY_MS));
      const lastDay = Math.min(plan.dayCount - 1, Math.round((cycleEnd.getTime() - periodStartDate.getTime()) / DAY_MS));
      for (const employeeId of employeeOrder) {
        const row = employeeIndex.get(employeeId);
        let actual = 0;
        for (let day = firstDay; day <= lastDay; day += 1) {
          if (statutoryCodes.has(assignment(plan, row, day))) actual += 1;
        }
        const deficit = Math.max(0, cycle.required - actual);
        if (deficit === 0) continue;
        const employee = employees.get(employeeId) ?? { id: employeeId, name: employeeId };
        statutoryPenalty += deficit * weights.statutoryHolidayDeficitDay;
        statutoryViolationCount += 1;
        statutoryViolationAmount += deficit;
        addViolation(
          violations,
          "statutory",
          "statutoryHolidayDeficit",
          employee,
          Array.from({ length: lastDay - firstDay + 1 }, (_, index) => firstDay + index),
          deficit,
          `${employee.name}の${isoDate(cycle.start)}開始区分で法定休日が${deficit}日不足しています。`
        );
      }
    }
    if (incompleteCycle) {
      verificationIssues.push({
        type: "statutoryCycleIncomplete",
        message: "法定休日の判定期間が期間外にかかるため、一部の週（周期）は未確認"
      });
    }
  }

  const restMinimumMinutes = Math.max(0, Number(settings.restMinimumMinutes) || 0);
  const weekendDays = [];
  const lateDays = [];

  for (const employeeId of employeeOrder) {
    const row = employeeIndex.get(employeeId);
    const employee = employees.get(employeeId) ?? { id: employeeId, name: employeeId };
    const maxConsecutiveWorkDays = Math.max(
      0,
      Number(employee.maxConsecutiveWorkDays ?? settings.maxConsecutiveWorkDays) || 0
    );
    const metrics = breakdownByEmployee[employeeId];
    const codes = Array.from({ length: plan.dayCount }, (_, day) => assignment(plan, row, day));
    const types = codes.map((code) => shiftTypes.get(code) ?? null);

    for (let day = 0; day < plan.dayCount; day += 1) {
      const shift = types[day];
      if (shift?.isDayOff) metrics.daysOff += 1;
      if (!shift || shift.isDayOff) continue;
      metrics.overtimeMinutes += shift.overtimeMinutes;
      const weekday = dateAt(plan.periodStart, day).getUTCDay();
      if (weekday === 0 || weekday === 6) metrics.weekendWorkDays += 1;
      if (shift.isLateShift) metrics.lateShiftDays += 1;
    }

    const previousCode = previousKnown ? boundaryCode(settings, "previous", employeeId) : null;
    const nextCode = nextKnown ? boundaryCode(settings, "next", employeeId) : null;
    const restTypes = [shiftTypes.get(previousCode) ?? null, ...types, shiftTypes.get(nextCode) ?? null];
    for (let index = 1; index < restTypes.length; index += 1) {
      const before = restTypes[index - 1];
      const after = restTypes[index];
      if (!before || before.isDayOff || !after || after.isDayOff) continue;
      const gap = Number(after.startMinutes) + 1440 - Number(before.endMinutes);
      const deficitMinutes = Math.max(0, restMinimumMinutes - gap);
      if (deficitMinutes === 0) continue;
      const units = Math.ceil(deficitMinutes / 15);
      internalPenalty += units * weights.restDeficit15Minutes;
      internalViolationCount += 1;
      internalViolationAmount += units;
      const day = Math.max(0, Math.min(plan.dayCount - 1, index - 1));
      addViolation(
        violations,
        "internal",
        "restDeficit",
        employee,
        [day],
        units,
        `${employee.name} ${isoDate(dateAt(plan.periodStart, day))} 勤務間隔が基準より${deficitMinutes}分不足`
      );
    }

    let currentRunStart = -1;
    for (let day = 0; day <= plan.dayCount; day += 1) {
      const working = day < plan.dayCount && types[day] && !types[day].isDayOff;
      if (working && currentRunStart < 0) currentRunStart = day;
      if (working) continue;
      if (currentRunStart >= 0) {
        const length = day - currentRunStart;
        metrics.maxConsecutiveWorkDays = Math.max(metrics.maxConsecutiveWorkDays, length);
        const excess = Math.max(0, length - maxConsecutiveWorkDays);
        if (excess > 0) {
          internalPenalty += (excess ** 2) * weights.consecutiveExcessSquared;
          internalViolationCount += 1;
          internalViolationAmount += excess;
          addViolation(
            violations,
            "internal",
            "consecutiveExcess",
            employee,
            Array.from({ length }, (_, index) => currentRunStart + index),
            excess,
            `${employee.name}の連続勤務が上限${maxConsecutiveWorkDays}日を${excess}日超過しています。`
          );
        }
        currentRunStart = -1;
      }
    }

    if (Number.isFinite(Number(employee.targetDaysOff))) {
      const target = Math.max(0, Number(employee.targetDaysOff));
      const difference = metrics.daysOff - target;
      if (difference !== 0) {
        const amount = Math.abs(difference);
        internalPenalty += amount * weights.daysOffDeviationDay[difference < 0 ? "deficit" : "excess"];
        internalViolationCount += 1;
        internalViolationAmount += amount;
        addViolation(
          violations,
          "internal",
          "daysOffDeviation",
          employee,
          [],
          amount,
          `${employee.name}の所定休日が目標${target}日に対して${metrics.daysOff}日です。`
        );
      }
    }

    const fixedOvertime = Math.max(0, Number(employee.fixedOvertimeMinutes) || 0);
    metrics.overtimeExcessMinutes = Math.max(0, metrics.overtimeMinutes - fixedOvertime);
    overtimePenalty += Math.ceil(metrics.overtimeExcessMinutes / 15) * weights.overtimeExcess15Minutes;
    weekendDays.push(metrics.weekendWorkDays);
    lateDays.push(metrics.lateShiftDays);
  }

  const estimatedShortageByScope = {};
  for (let day = 0; day < plan.dayCount; day += 1) {
    const dayResult = evaluateEstimatedCoverageForDay(plan, day, {
      ...context,
      shiftTypes,
      employees,
      settings
    }, weights);
    coveragePenalty += dayResult.coveragePenalty;
    for (const [key, shortage] of Object.entries(dayResult.estimatedShortageByScope)) {
      estimatedShortageByScope[key] = (estimatedShortageByScope[key] ?? 0) + shortage;
    }
  }
  const estimatedShortagePersonSlots = estimatedShortageByScope.total ?? 0;

  for (const request of preferences) {
    const row = employeeIndex.get(request.employeeId);
    const day = Number(request.day);
    if (row === undefined || !Number.isInteger(day) || day < 0 || day >= plan.dayCount) continue;
    const code = assignment(plan, row, day);
    const shift = shiftTypes.get(code);
    const employee = employees.get(request.employeeId) ?? { id: request.employeeId, name: request.employeeId };
    if (request.kind === "dayOff" && !shift?.isDayOff) {
      preferencePenalty += weights.missedDayOffRequest;
      preferenceViolationCount += 1;
      preferenceViolationAmount += 1;
      addViolation(
        violations,
        "preference",
        "missedDayOffRequest",
        employee,
        [day],
        1,
        `${employee.name}の希望休が満たされていません。`
      );
    }
    if (request.kind === "shift" && code !== request.shiftCode) {
      preferencePenalty += weights.missedShiftRequest;
      preferenceViolationCount += 1;
      preferenceViolationAmount += 1;
      addViolation(
        violations,
        "preference",
        "missedShiftRequest",
        employee,
        [day],
        1,
        `${employee.name}の希望シフト${request.shiftCode}が満たされていません。`
      );
    }
  }

  fairnessPenalty = weights.fairnessUnit * (
    populationVariance(weekendDays) + populationVariance(lateDays)
  );

  const baseline = context?.baselinePlan;
  if (baseline?.assignments) {
    for (let employee = 0; employee < employeeOrder.length; employee += 1) {
      for (let day = 0; day < plan.dayCount; day += 1) {
        if (assignment(plan, employee, day) !== assignment(baseline, employee, day)) {
          changePenalty += weights.changedCell;
        }
      }
    }
  }

  const score = statutoryPenalty
    + internalPenalty
    + coveragePenalty
    + overtimePenalty
    + preferencePenalty
    + fairnessPenalty
    + changePenalty;

  return {
    solverConfigVersion: SOLVER_CONFIG_VERSION,
    score,
    statutoryPenalty,
    internalPenalty,
    coveragePenalty,
    overtimePenalty,
    preferencePenalty,
    fairnessPenalty,
    changePenalty,
    statutoryViolationCount,
    statutoryViolationAmount,
    internalViolationCount,
    internalViolationAmount,
    preferenceViolationCount,
    preferenceViolationAmount,
    constraintLayers: {
      statutory: {
        violationCount: statutoryViolationCount,
        violationAmount: statutoryViolationAmount,
        penalty: statutoryPenalty
      },
      internal: {
        violationCount: internalViolationCount,
        violationAmount: internalViolationAmount,
        penalty: internalPenalty
      },
      preference: {
        violationCount: preferenceViolationCount,
        violationAmount: preferenceViolationAmount,
        penalty: preferencePenalty
      }
    },
    estimatedShortagePersonSlots,
    estimatedShortageByScope,
    violations,
    verificationIssues,
    breakdownByEmployee
  };
}
