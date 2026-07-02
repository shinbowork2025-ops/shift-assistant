export const DEFAULT_SHIFT_TYPES = Object.freeze([
  { code: "early", name: "早番", shortLabel: "早", start: "09:00", end: "18:00", isWork: true, overtimeMinutes: 0 },
  { code: "middle", name: "中番", shortLabel: "中", start: "11:00", end: "20:00", isWork: true, overtimeMinutes: 0 },
  { code: "late", name: "遅番", shortLabel: "遅", start: "12:00", end: "21:00", isWork: true, overtimeMinutes: 0 },
  { code: "short", name: "短時間", shortLabel: "短", start: "09:00", end: "13:00", isWork: true, overtimeMinutes: 0 },
  { code: "off", name: "公休", shortLabel: "休", start: "", end: "", isWork: false, paidMinutes: 0, overtimeMinutes: 0 },
  { code: "paid", name: "有休", shortLabel: "有", start: "", end: "", isWork: false, paidMinutes: 450, overtimeMinutes: 0 },
  { code: "request", name: "希望休", shortLabel: "希", start: "", end: "", isWork: false, paidMinutes: 0, overtimeMinutes: 0 }
]);
