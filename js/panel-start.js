import { initializeTimeEditor } from "./time-editor.js";

if (typeof document !== "undefined") {
  const container = document.getElementById("dailyChartContainer");
  if (container) initializeTimeEditor(container);
}
