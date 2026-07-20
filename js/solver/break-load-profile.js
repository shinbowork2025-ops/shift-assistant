import { SLOTS_PER_DAY } from "./solver-config.js";
import { enumerateSegmentStartsSimple } from "./break-policy.js";
import { minutesToSlot } from "./time-slots.js";

export function estimatedBreakLoadProfile(shiftType, breakConstraints = {}) {
  const profile = new Float64Array(SLOTS_PER_DAY);
  if (!shiftType || shiftType.isDayOff) return profile;
  // 休憩配置可能性は従業員ごとのシフト区分・休憩方針だけで決まり、
  // 他従業員の休憩には依存しない。人数不足への影響だけを後段で合算する。
  for (const segment of shiftType.breakPolicy?.segments ?? []) {
    const starts = enumerateSegmentStartsSimple(shiftType, segment, breakConstraints);
    if (starts.length === 0) continue;
    const load = 1 / starts.length;
    const slotCount = Number(segment.duration) / 15;
    for (const start of starts) {
      const firstSlot = minutesToSlot(start);
      for (let offset = 0; offset < slotCount; offset += 1) {
        const slot = firstSlot + offset;
        if (slot >= 0 && slot < profile.length) profile[slot] += load;
      }
    }
  }
  return profile;
}
