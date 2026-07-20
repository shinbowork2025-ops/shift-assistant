import { SLOT_MINUTES } from "./solver-config.js";
import { scheduledWorkMinutes } from "./time-slots.js";
import {
  enumerateBreakPlacementCandidates,
  enumerateSegmentStartsSimple
} from "./break-placement-candidates.js";

export { enumerateBreakPlacementCandidates, enumerateSegmentStartsSimple };

export function validateBreakPolicyForShift(shiftType, breakPolicy, breakConstraints = {}) {
  if (!shiftType || shiftType.isDayOff) {
    return { ok: true, issues: [], samplePlacement: [] };
  }

  const issues = [];
  const segments = Array.isArray(breakPolicy?.segments) ? breakPolicy.segments : [];
  const totalMinutes = Number(breakPolicy?.totalMinutes);
  const startMinutes = Number(shiftType.startMinutes);
  const endMinutes = Number(shiftType.endMinutes);

  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes < 0 || endMinutes <= startMinutes || endMinutes > 1440) {
    issues.push("勤務シフトの開始・終了時刻が不正です。");
  }
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0 || totalMinutes % SLOT_MINUTES !== 0) {
    issues.push("休憩合計は0以上かつ15分単位で指定してください。");
  }

  let durationSum = 0;
  let previousOffset = -Infinity;
  for (const [index, segment] of segments.entries()) {
    const duration = Number(segment?.duration);
    const targetOffset = Number(segment?.targetOffset);
    if (!Number.isFinite(duration) || duration <= 0 || duration % SLOT_MINUTES !== 0) {
      issues.push(`${index + 1}番目の休憩時間は正の15分単位で指定してください。`);
    } else {
      durationSum += duration;
    }
    if (!Number.isFinite(targetOffset)) {
      issues.push(`${index + 1}番目の休憩目標時刻が不正です。`);
    } else if (targetOffset < previousOffset) {
      issues.push("休憩セグメントの目標時刻は昇順にしてください。");
    }
    previousOffset = targetOffset;
    if (segment?.type !== "small" && segment?.type !== "lunch") {
      issues.push(`${index + 1}番目の休憩種別はsmallまたはlunchにしてください。`);
    }
  }
  if (Number.isFinite(totalMinutes) && totalMinutes !== durationSum) {
    issues.push(`休憩合計${totalMinutes}分とセグメント合計${durationSum}分が一致しません。`);
  }

  const workMinutes = scheduledWorkMinutes({ ...shiftType, breakPolicy });
  if (workMinutes > 480 && totalMinutes < 60) {
    issues.push(`予定実働${workMinutes}分に対して休憩${totalMinutes}分は下限60分を満たしません。`);
  } else if (workMinutes > 360 && totalMinutes < 45) {
    issues.push(`予定実働${workMinutes}分に対して休憩${totalMinutes}分は下限45分を満たしません。`);
  }

  let samplePlacement = null;
  if (issues.length === 0) {
    const candidates = enumerateBreakPlacementCandidates(shiftType, breakPolicy, [], breakConstraints);
    samplePlacement = candidates[0]?.map((item) => item.startMinute) ?? null;
    if (samplePlacement === null) issues.push("全セグメントを勤務時間内へ配置できません。");
  }

  return { ok: issues.length === 0, issues, samplePlacement: issues.length ? null : samplePlacement };
}
