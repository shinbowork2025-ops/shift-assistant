export function roundToQuarterHour(value) {
  if (!/^\d{1,2}:\d{2}$/.test(value)) return value;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return value;
  const rounded = Math.min(23 * 60 + 45, Math.max(0, Math.round((hours * 60 + minutes) / 15) * 15));
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}
