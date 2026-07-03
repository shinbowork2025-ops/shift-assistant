export const REST_PATTERNS = Object.freeze([
  {
    id: "none",
    name: "自動配置しない",
    shortLabel: "手動",
    cycle: [],
    maxConsecutiveWorkDays: 0,
    description: "公休を自動配置せず、手入力とロックだけで管理します。"
  },
  {
    id: "5on2off",
    name: "5勤2休",
    shortLabel: "5勤2休",
    cycle: ["work", "work", "work", "work", "work", "off", "off"],
    maxConsecutiveWorkDays: 5,
    description: "5日勤務して2連休を繰り返します。"
  },
  {
    id: "3on1off",
    name: "3勤1休",
    shortLabel: "3勤1休",
    cycle: ["work", "work", "work", "off"],
    maxConsecutiveWorkDays: 3,
    description: "3日勤務して1日休みます。"
  },
  {
    id: "2on1off",
    name: "2勤1休",
    shortLabel: "2勤1休",
    cycle: ["work", "work", "off"],
    maxConsecutiveWorkDays: 2,
    description: "2日勤務して1日休みます。"
  },
  {
    id: "3on1-2on1",
    name: "3勤1休＋2勤1休",
    shortLabel: "3-1/2-1",
    cycle: ["work", "work", "work", "off", "work", "work", "off"],
    maxConsecutiveWorkDays: 3,
    description: "3勤1休と2勤1休を交互に繰り返します。"
  },
  {
    id: "4on1-4on2",
    name: "4勤1休＋4勤2休",
    shortLabel: "4-1/4-2",
    cycle: ["work", "work", "work", "work", "off", "work", "work", "work", "work", "off", "off"],
    maxConsecutiveWorkDays: 4,
    description: "4勤1休と4勤2休を交互に繰り返します。"
  },
  {
    id: "weekly-split",
    name: "週2休・分散",
    shortLabel: "週2分散",
    cycle: ["work", "work", "off", "work", "work", "off", "work"],
    maxConsecutiveWorkDays: 3,
    description: "1週間の中で休みを分散させます。"
  }
]);

const PATTERN_MAP = new Map(REST_PATTERNS.map((pattern) => [pattern.id, pattern]));
const WEEKDAY_LABELS = Object.freeze(["日", "月", "火", "水", "木", "金", "土"]);

export function getRestPattern(patternId) {
  return PATTERN_MAP.get(patternId) ?? PATTERN_MAP.get("none");
}

export function normalizeRestPatternId(value) {
  const id = String(value ?? "none");
  return PATTERN_MAP.has(id) ? id : "none";
}

export function normalizeRestPatternOffset(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return -1;
  return Math.max(-1, Math.min(30, number));
}

export function normalizeTargetDaysOff(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(31, Math.round(number)));
}

export function normalizeFixedDaysOff(value) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(/[|,、\s]+/)
      .filter(Boolean);
  return [...new Set(source.map((item) => Number(item)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
}

export function weekdayLabel(day) {
  return WEEKDAY_LABELS[day] ?? "";
}

export function fixedDaysOffLabel(days) {
  const normalized = normalizeFixedDaysOff(days);
  return normalized.length ? normalized.map((day) => `${weekdayLabel(day)}曜`).join("・") : "なし";
}

export function employeeRestPatternSummary(employee) {
  const pattern = getRestPattern(employee?.restPatternId);
  if (pattern.id === "none") return pattern.shortLabel;
  const target = normalizeTargetDaysOff(employee?.targetDaysOff);
  return target > 0 ? `${pattern.shortLabel}/${target}休` : pattern.shortLabel;
}

export function restPatternOptions() {
  return REST_PATTERNS.map(({ id, name, description }) => ({ id, name, description }));
}
