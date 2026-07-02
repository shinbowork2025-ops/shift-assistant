export function createHistoryStack(limit = 50) {
  const maximum = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : 50;
  const undoEntries = [];
  const redoEntries = [];

  function cloneEntry(entry) {
    return structuredClone(entry);
  }

  function trimUndo() {
    if (undoEntries.length > maximum) undoEntries.splice(0, undoEntries.length - maximum);
  }

  return {
    record(entry) {
      if (!entry || typeof entry.label !== "string") return false;
      undoEntries.push(cloneEntry(entry));
      trimUndo();
      redoEntries.length = 0;
      return true;
    },

    undo() {
      const entry = undoEntries.pop();
      if (!entry) return null;
      redoEntries.push(cloneEntry(entry));
      return cloneEntry(entry);
    },

    redo() {
      const entry = redoEntries.pop();
      if (!entry) return null;
      undoEntries.push(cloneEntry(entry));
      trimUndo();
      return cloneEntry(entry);
    },

    clear() {
      undoEntries.length = 0;
      redoEntries.length = 0;
    },

    status() {
      return {
        canUndo: undoEntries.length > 0,
        canRedo: redoEntries.length > 0,
        undoLabel: undoEntries.at(-1)?.label ?? "",
        redoLabel: redoEntries.at(-1)?.label ?? "",
        undoCount: undoEntries.length,
        redoCount: redoEntries.length,
        limit: maximum
      };
    }
  };
}
