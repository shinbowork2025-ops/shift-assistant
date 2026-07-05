import { optimizeBreaks } from "./optimizer.js";

globalThis.addEventListener("message", (event) => {
  const requestId = event.data?.requestId;
  try {
    const payload = event.data?.payload ?? {};
    const result = optimizeBreaks(payload.dayPlan, payload.optimizerConfig);
    globalThis.postMessage({ requestId, ok: true, result });
  } catch (error) {
    globalThis.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
