export function normalizeAllowedShiftCodes(value) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[|,、\s]+/).filter(Boolean);
  return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))].slice(0, 100);
}

export function normalizePreferredShiftCode(value) {
  return String(value ?? "").trim().slice(0, 30);
}

export function normalizeAvoidLateEarly(value) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["0", "false", "no", "off", "しない", "無効"].includes(normalized)) return false;
    if (["1", "true", "yes", "on", "する", "有効"].includes(normalized)) return true;
  }
  return Boolean(value);
}

export function availableWorkShiftCodes(employee, workShiftTypes) {
  const allCodes = workShiftTypes.map((shiftType) => shiftType.code);
  const configured = normalizeAllowedShiftCodes(employee?.allowedShiftCodes);
  if (!configured.length) return allCodes;
  const valid = new Set(allCodes);
  return configured.filter((code) => valid.has(code));
}

export function workShiftPreferenceSummary(employee, workShiftTypes) {
  const allCount = workShiftTypes.length;
  const allowed = availableWorkShiftCodes(employee, workShiftTypes);
  const allowedLabel = allowed.length === allCount ? "全勤務" : `${allowed.length}種`;
  const preferred = normalizePreferredShiftCode(employee?.preferredShiftCode);
  return preferred ? `${allowedLabel}/優先:${preferred}` : allowedLabel;
}
