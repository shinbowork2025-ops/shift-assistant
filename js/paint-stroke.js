export function createPaintStroke(applyCell) {
  const visited = new Set();
  let changedCount = 0;

  return {
    visit(key, payload) {
      const normalizedKey = String(key ?? "");
      if (!normalizedKey || visited.has(normalizedKey)) return false;
      visited.add(normalizedKey);
      if (applyCell(payload)) changedCount += 1;
      return true;
    },

    summary() {
      return {
        visitedCount: visited.size,
        changedCount
      };
    }
  };
}
