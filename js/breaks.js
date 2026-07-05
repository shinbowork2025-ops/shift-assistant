import {
  state,
  dayFromDate,
  shiftDurationMinutes,
  timeToMinutes,
  minutesToTime,
  setBreaksForDate
} from "./model.js";
import { plannedBreakTemplates } from "./break-rules.js";
import { buildShiftTypeMap, getShiftCodeFromData } from "./month-overview.js";
import { optimizeBreaks, createGreedyBreaks, DEFAULT_OPTIMIZER_CONFIG } from "./optimizer.js";

const SLOT_MINUTES = 15;
const DEFAULT_BREAK_OPTIMIZER = Object.freeze({
  seed: DEFAULT_OPTIMIZER_CONFIG.seed,
  restarts: DEFAULT_OPTIMIZER_CONFIG.restarts,
  maxSweeps: DEFAULT_OPTIMIZER_CONFIG.maxSweeps,
  slotMinutes: SLOT_MINUTES,
  edgeBufferMinutes: 60,
  minGapMinutes: 60
});
let optimizerWorker = null;
let workerRequestId = 0;
const pendingWorkerRequests = new Map();

function workingAssignments(dateValue) {
  const monthValue = dateValue.slice(0, 7);
  const day = dayFromDate(dateValue);
  const shiftTypesByCode = buildShiftTypeMap(state.shiftTypes);
  return state.employees
    .map((employee) => {
      const shiftCode = getShiftCodeFromData(state.shifts, monthValue, employee.id, day);
      const shiftType = shiftTypesByCode.get(shiftCode) ?? null;
      return { employee, shiftCode, shiftType };
    })
    .filter((assignment) => assignment.shiftType?.isWork)
    .sort((a, b) => {
      const startDifference = timeToMinutes(a.shiftType.start) - timeToMinutes(b.shiftType.start);
      return startDifference || a.employee.order - b.employee.order || a.employee.name.localeCompare(b.employee.name, "ja");
    });
}

function toMinuteBreaks(breaks = []) {
  return [...breaks]
    .map((breakItem) => {
      const startMinute = timeToMinutes(breakItem?.start);
      const endMinute = timeToMinutes(breakItem?.end);
      if (startMinute === null || endMinute === null || endMinute <= startMinute) return null;
      return {
        type: breakItem.type,
        label: breakItem.label,
        locked: breakItem.locked === true,
        startMinute,
        endMinute
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

function toDisplayBreaks(breaks = []) {
  return breaks.map((breakItem) => ({
    type: breakItem.type,
    label: breakItem.label,
    start: minutesToTime(breakItem.startMinute),
    end: minutesToTime(breakItem.endMinute),
    ...(breakItem.locked ? { locked: true } : {})
  }));
}

function assignmentBreakMap(assignments, sourceBreaksByEmployee = {}) {
  const result = {};
  for (const { employee } of assignments) {
    result[employee.id] = toMinuteBreaks(sourceBreaksByEmployee[employee.id] ?? []);
  }
  return result;
}

function buildDayPlan(assignments) {
  return {
    employees: assignments
      .map(({ employee, shiftType }) => {
        const shiftStartMinute = timeToMinutes(shiftType.start);
        const shiftEndMinute = timeToMinutes(shiftType.end);
        if (shiftStartMinute === null || shiftEndMinute === null || shiftEndMinute <= shiftStartMinute) return null;
        return {
          id: employee.id,
          name: employee.name,
          order: Number(employee.order ?? 0),
          shiftStartMinute,
          shiftEndMinute,
          templates: plannedBreakTemplates(shiftDurationMinutes(shiftType))
        };
      })
      .filter(Boolean)
  };
}

function mergeOptimizationResult(dayPlan, optimizedBreaksByEmployee, baseBreaksByEmployee) {
  const result = structuredClone(baseBreaksByEmployee);
  for (const employee of dayPlan.employees) {
    result[employee.id] = toDisplayBreaks(optimizedBreaksByEmployee[employee.id] ?? []);
  }
  for (const employeeId of Object.keys(result)) {
    if (!Array.isArray(result[employeeId]) || result[employeeId].length > 0) continue;
    result[employeeId] = [];
  }
  return result;
}

function workerSupported() {
  return typeof Worker === "function";
}

function workerConfigPath() {
  return new URL("./optimizerWorker.js", import.meta.url);
}

function ensureOptimizerWorker() {
  if (!workerSupported()) return null;
  if (optimizerWorker) return optimizerWorker;
  optimizerWorker = new Worker(workerConfigPath(), { type: "module" });
  optimizerWorker.addEventListener("message", (event) => {
    const requestId = event.data?.requestId;
    if (!pendingWorkerRequests.has(requestId)) return;
    const handlers = pendingWorkerRequests.get(requestId);
    pendingWorkerRequests.delete(requestId);
    if (event.data?.ok) handlers.resolve(event.data.result);
    else handlers.reject(new Error(event.data?.error ?? "最適化ワーカーで不明なエラーが発生しました。"));
  });
  optimizerWorker.addEventListener("error", (event) => {
    const error = new Error(event.message || "最適化ワーカーの起動に失敗しました。");
    for (const handlers of pendingWorkerRequests.values()) handlers.reject(error);
    pendingWorkerRequests.clear();
    optimizerWorker?.terminate();
    optimizerWorker = null;
  });
  return optimizerWorker;
}

function optimizeWithWorker(dayPlan, optimizationOptions) {
  const worker = ensureOptimizerWorker();
  if (!worker) throw new Error("この環境ではWorkerを利用できません。");
  workerRequestId += 1;
  const requestId = workerRequestId;
  return new Promise((resolve, reject) => {
    pendingWorkerRequests.set(requestId, { resolve, reject });
    worker.postMessage({
      requestId,
      payload: {
        dayPlan,
        optimizerConfig: optimizationOptions
      }
    });
  });
}

function optimizeLocally(dayPlan, optimizationOptions) {
  return optimizeBreaks(dayPlan, optimizationOptions);
}

function normalizeSeed(seed) {
  return Number.isFinite(Number(seed)) ? Number(seed) : DEFAULT_BREAK_OPTIMIZER.seed;
}

function resolveTargetIds(assignments, employeeIds) {
  const workingIds = new Set(assignments.map(({ employee }) => employee.id));
  if (!employeeIds) return [...workingIds];
  return [...new Set(employeeIds)].filter((employeeId) => workingIds.has(employeeId));
}

function buildBaseBreaks(dateValue, employeeIds) {
  const base = employeeIds ? structuredClone(state.breaks[dateValue] ?? {}) : {};
  if (employeeIds) {
    for (const employeeId of employeeIds) delete base[employeeId];
  }
  return base;
}

function runBreakOptimizationSync(dateValue, options = {}) {
  const assignments = workingAssignments(dateValue);
  const dayPlan = buildDayPlan(assignments);
  const targetEmployeeIds = resolveTargetIds(assignments, options.employeeIds ?? null);
  const optimizerConfig = {
    ...DEFAULT_BREAK_OPTIMIZER,
    ...options,
    seed: normalizeSeed(options.seed)
  };
  const baseBreaksByEmployee = buildBaseBreaks(dateValue, options.employeeIds ?? null);
  const existingBreaksByEmployee = assignmentBreakMap(assignments, baseBreaksByEmployee);
  const initialBreaksByEmployee = createGreedyBreaks(dayPlan, {
    ...optimizerConfig,
    targetEmployeeIds,
    baseBreaksByEmployee: existingBreaksByEmployee
  });
  const optimizationResult = optimizeLocally(dayPlan, {
    ...optimizerConfig,
    targetEmployeeIds,
    initialBreaksByEmployee
  });
  return {
    dateValue,
    dayPlan,
    targetEmployeeIds,
    baseBreaksByEmployee,
    initialBreaksByEmployee,
    optimizationResult
  };
}

async function runBreakOptimizationAsync(dateValue, options = {}) {
  const assignments = workingAssignments(dateValue);
  const dayPlan = buildDayPlan(assignments);
  const targetEmployeeIds = resolveTargetIds(assignments, options.employeeIds ?? null);
  const optimizerConfig = {
    ...DEFAULT_BREAK_OPTIMIZER,
    ...options,
    seed: normalizeSeed(options.seed)
  };
  const baseBreaksByEmployee = buildBaseBreaks(dateValue, options.employeeIds ?? null);
  const existingBreaksByEmployee = assignmentBreakMap(assignments, baseBreaksByEmployee);
  const initialBreaksByEmployee = createGreedyBreaks(dayPlan, {
    ...optimizerConfig,
    targetEmployeeIds,
    baseBreaksByEmployee: existingBreaksByEmployee
  });

  let optimizationResult;
  if (options.useWorker !== false && workerSupported()) {
    try {
      optimizationResult = await optimizeWithWorker(dayPlan, {
        ...optimizerConfig,
        targetEmployeeIds,
        initialBreaksByEmployee
      });
    } catch {
      optimizationResult = optimizeLocally(dayPlan, {
        ...optimizerConfig,
        targetEmployeeIds,
        initialBreaksByEmployee
      });
    }
  } else {
    optimizationResult = optimizeLocally(dayPlan, {
      ...optimizerConfig,
      targetEmployeeIds,
      initialBreaksByEmployee
    });
  }

  return {
    dateValue,
    dayPlan,
    targetEmployeeIds,
    baseBreaksByEmployee,
    initialBreaksByEmployee,
    optimizationResult
  };
}

export function generateBreaksForDate(dateValue, employeeIds = null, options = {}) {
  const {
    dayPlan,
    baseBreaksByEmployee,
    initialBreaksByEmployee,
    optimizationResult
  } = runBreakOptimizationSync(dateValue, {
    ...options,
    employeeIds,
    useWorker: false
  });
  const mergedBreaks = mergeOptimizationResult(dayPlan, optimizationResult.breaksByEmployee, baseBreaksByEmployee);
  setBreaksForDate(dateValue, mergedBreaks, { save: options.save !== false });
  return mergedBreaks;
}

export async function createBreakOptimizationProposalForDate(dateValue, options = {}) {
  const startedAt = performance.now();
  const {
    dayPlan,
    targetEmployeeIds,
    baseBreaksByEmployee,
    initialBreaksByEmployee,
    optimizationResult
  } = await runBreakOptimizationAsync(dateValue, {
    ...options,
    useWorker: options.useWorker !== false
  });
  const initialBreaks = mergeOptimizationResult(dayPlan, initialBreaksByEmployee, baseBreaksByEmployee);
  const optimizedBreaks = mergeOptimizationResult(dayPlan, optimizationResult.breaksByEmployee, baseBreaksByEmployee);
  return {
    dateValue,
    targetEmployeeIds,
    initialBreaks,
    optimizedBreaks,
    initialScore: optimizationResult.baselineScore,
    initialBreakdown: optimizationResult.baselineBreakdown,
    optimizedScore: optimizationResult.score,
    optimizedBreakdown: optimizationResult.breakdown,
    hardOk: optimizationResult.hard.ok,
    hardIssues: optimizationResult.hard.issues,
    sweeps: optimizationResult.sweeps,
    restarts: optimizationResult.restarts,
    elapsedMs: Math.round(performance.now() - startedAt)
  };
}

// 旧データを開いただけでは休憩を再配置しない。
// 不足や不正な配置は画面側の検証警告で知らせ、再配置はユーザー操作で行う。
export function ensureBreaksForDate(dateValue) {
  return state.breaks[dateValue] ?? {};
}

export function availableWorkersAt(dateValue, slotStart) {
  const monthValue = dateValue.slice(0, 7);
  const day = dayFromDate(dateValue);
  const shiftTypesByCode = buildShiftTypeMap(state.shiftTypes);
  let count = 0;
  for (const employee of state.employees) {
    const shiftCode = getShiftCodeFromData(state.shifts, monthValue, employee.id, day);
    const shiftType = shiftTypesByCode.get(shiftCode) ?? null;
    if (!shiftType?.isWork) continue;
    const start = timeToMinutes(shiftType.start);
    const end = timeToMinutes(shiftType.end);
    if (slotStart < start || slotStart >= end) continue;

    const isOnBreak = (state.breaks[dateValue]?.[employee.id] ?? []).some((breakItem) => {
      const breakStart = timeToMinutes(breakItem.start);
      const breakEnd = timeToMinutes(breakItem.end);
      return slotStart >= breakStart && slotStart < breakEnd;
    });
    if (!isOnBreak) count += 1;
  }
  return count;
}
