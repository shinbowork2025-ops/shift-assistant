import { optimizeMonthScheduleAsync } from "./month-optimizer.js";

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
  try {
    const result = await optimizeMonthScheduleAsync(message.plan, message.config ?? {}, {
      shouldStop: () => stopRequested,
      onProgress: (progress) => self.postMessage({ type: "progress", progress })
    });
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message ?? String(error) });
  } finally {
    running = false;
  }
});
