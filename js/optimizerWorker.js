import { optimizeBreaks } from "./optimizer.js";

self.addEventListener("message", (event) => {
  const startedAt = performance.now();
  try {
    const result = optimizeBreaks(event.data.dayPlan, event.data.config ?? {});
    self.postMessage({
      ok: true,
      result: {
        ...result,
        elapsedMs: performance.now() - startedAt
      }
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
