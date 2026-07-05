if (typeof document !== "undefined") {
  const container = document.getElementById("dailyChartContainer");
  if (container) {
    void import("./time-editor.js").then(({ initializeTimeEditor }) => {
      initializeTimeEditor(container);
    });
  }
}
