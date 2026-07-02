export const WEEKDAY_LABELS = Object.freeze(["日", "月", "火", "水", "木", "金", "土"]);

export function currentMonthValue(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function currentDateValue(now = new Date()) {
  return `${currentMonthValue(now)}-${String(now.getDate()).padStart(2, "0")}`;
}

export function isMonthValue(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isDateValue(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value);
}

export function isValidTime(value) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value.trim())) return false;
  const [hours, minutes] = value.trim().split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function timeToMinutes(value) {
  if (!isValidTime(value)) return null;
  const [hours, minutes] = value.trim().split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function getDaysInMonth(monthValue) {
  const [year, month] = String(monthValue).split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

export function dateKey(monthValue, day) {
  return `${monthValue}-${String(day).padStart(2, "0")}`;
}

export function dayFromDate(dateValue) {
  return Number(String(dateValue).slice(-2));
}

export function getDayInfo(monthValue, day) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay();
  return {
    day,
    weekday,
    label: WEEKDAY_LABELS[weekday],
    dateValue: dateKey(monthValue, day)
  };
}

export function buildMonthDays(monthValue) {
  return Array.from(
    { length: getDaysInMonth(monthValue) },
    (_, index) => getDayInfo(monthValue, index + 1)
  );
}

export function monthDisplayName(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  return `${year}年${month}月`;
}

export function dateDisplayName(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return `${year}年${month}月${day}日（${WEEKDAY_LABELS[date.getDay()]}）`;
}

export function offsetMonthValue(monthValue, offset) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function offsetDateValue(dateValue, offset) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
