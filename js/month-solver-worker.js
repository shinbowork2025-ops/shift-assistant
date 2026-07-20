import { solveMonthScheduleAsync, solveMonthSchedulePrecisionAsync } from "./month-solver.js";
import {
  createSolverInputFingerprint,
  createWorkerProgressMessage,
  createWorkerResultMessage
} from "./month-solver-worker-protocol.js";

let stopRequested = false;
let running = false;

self.addEventListener("message", async (event) => {
  const message = event.data ?? {};
  if (message.type === "stop") {
    stopRequested = true;
    return;
  }
  if (message.type !== "start" || running) return;

  running = true;
  stopRequested = false;
  const planSnapshot = message.planSnapshot ?? message.plan;
  const metadata = {
    scheduleRevision: message.scheduleRevision ?? null,
    inputFingerprint: message.inputFingerprint ?? ""
  };
  try {
    if (!planSnapshot || typeof planSnapshot !== "object") throw new Error("探索入力がありません。");
    const computedFingerprint = createSolverInputFingerprint(planSnapshot);
    metadata.inputFingerprint ||= computedFingerprint;
    if (message.inputFingerprint && message.inputFingerprint !== computedFingerprint) {
      throw new Error("探索入力のフィンガープリントが一致しません。");
    }
    const solverConfig = {
      ...(message.config ?? {}),
      ...(message.solverConfig ?? {}),
      masterSeed: message.masterSeed ?? message.solverConfig?.masterSeed ?? message.config?.seed ?? 1,
      ...(message.timeBudgetMs !== undefined ? { timeBudgetMs: message.timeBudgetMs } : {}),
      ...(message.fixedBlockCount !== undefined ? { fixedBlockCount: message.fixedBlockCount } : {})
    };
    const mode = message.mode ?? solverConfig.mode;
    const solve = mode === "precision"
      ? solveMonthSchedulePrecisionAsync
      : solveMonthScheduleAsync;
    const result = await solve(planSnapshot, solverConfig, {
      shouldStop: () => stopRequested,
      onProgress: (progress) => self.postMessage(createWorkerProgressMessage(metadata, progress))
    });
    self.postMessage(createWorkerResultMessage(metadata, result, solverConfig));
  } catch (error) {
    self.postMessage({
      type: "error",
      ...metadata,
      message: error?.message ?? String(error)
    });
  } finally {
    running = false;
  }
});
