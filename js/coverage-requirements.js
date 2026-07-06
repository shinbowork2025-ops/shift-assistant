// 時間帯別の必要人数設定と、その充足評価。
// 各バンドは「適用する曜日」「時間帯」「必要な合計人数」「雇用区分ごとの最小人数」を持つ。
// DOMやアプリ状態に依存しない純粋モジュール。
import { isValidTime, timeToMinutes } from "./date-time.js";
import { EMPLOYMENT_TYPES } from "./employment-types.js";
import { createId } from "./ids.js";

export const REQUIREMENT_SCOPES = Object.freeze(["everyday", "weekday", "weekend"]);
export const REQUIREMENT_SCOPE_LABELS = Object.freeze({
  everyday: "毎日",
  weekday: "平日",
  weekend: "土日"
});

const MAX_REQUIRED = 99;
const MAX_REQUIREMENTS = 20;

function nonNegativeInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(MAX_REQUIRED, Math.max(0, Math.round(number)));
}

function zeroByType() {
  return Object.fromEntries(EMPLOYMENT_TYPES.map((type) => [type.code, 0]));
}

export function normalizeCoverageRequirement(candidate, index = 0) {
  const requiredByType = zeroByType();
  for (const type of EMPLOYMENT_TYPES) {
    requiredByType[type.code] = nonNegativeInt(candidate?.requiredByType?.[type.code]);
  }
  return {
    id: typeof candidate?.id === "string" && candidate.id ? candidate.id : createId(`coverage-${index + 1}`),
    scope: REQUIREMENT_SCOPES.includes(candidate?.scope) ? candidate.scope : "everyday",
    start: isValidTime(candidate?.start) ? candidate.start.trim() : "",
    end: isValidTime(candidate?.end) ? candidate.end.trim() : "",
    requiredTotal: nonNegativeInt(candidate?.requiredTotal),
    requiredByType
  };
}

export function normalizeCoverageRequirements(candidate) {
  return (Array.isArray(candidate) ? candidate : [])
    .slice(0, MAX_REQUIREMENTS)
    .map((item, index) => normalizeCoverageRequirement(item, index));
}

// 時間帯が正しく、かつ何らかの人数を要求しているバンドだけを評価対象にする。
export function requirementIsActive(requirement) {
  const start = timeToMinutes(requirement?.start);
  const end = timeToMinutes(requirement?.end);
  if (start === null || end === null || end <= start) return false;
  if (requirement.requiredTotal > 0) return true;
  return EMPLOYMENT_TYPES.some((type) => requirement.requiredByType[type.code] > 0);
}

export function requirementAppliesToWeekday(requirement, weekday) {
  if (requirement.scope === "weekday") return weekday >= 1 && weekday <= 5;
  if (requirement.scope === "weekend") return weekday === 0 || weekday === 6;
  return true;
}

export function activeRequirementsForWeekday(requirements, weekday) {
  return normalizeCoverageRequirements(requirements)
    .filter(requirementIsActive)
    .filter((requirement) => requirementAppliesToWeekday(requirement, weekday));
}

// 有効なバンドが覆う時間帯の最小・最大（分）。1日チャートの表示範囲を広げるのに使う。
export function requirementBounds(activeRequirements) {
  let start = null;
  let end = null;
  for (const requirement of activeRequirements) {
    const requirementStart = timeToMinutes(requirement.start);
    const requirementEnd = timeToMinutes(requirement.end);
    start = start === null ? requirementStart : Math.min(start, requirementStart);
    end = end === null ? requirementEnd : Math.max(end, requirementEnd);
  }
  return { start, end };
}

function formatMinute(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function formatBandMessage(report) {
  const parts = [];
  if (report.maxTotalShort > 0) parts.push(`合計${report.maxTotalShort}人不足`);
  for (const type of EMPLOYMENT_TYPES) {
    if (report.maxByTypeShort[type.code] > 0) parts.push(`${type.label}${report.maxByTypeShort[type.code]}人不足`);
  }
  return `${report.requirement.start}〜${report.requirement.end}：${parts.join(" / ")}`;
}

// activeRequirements は activeRequirementsForWeekday の結果を渡す。
// slots/coverage/coverageByType は buildDailyOverview の同名データ（15分刻み）。
export function evaluateCoverage({ activeRequirements = [], slots = [], coverage = [], coverageByType = {} }) {
  const perSlot = slots.map((minute, index) => {
    let requiredTotal = 0;
    const requiredByType = zeroByType();
    let hasRequirement = false;
    for (const requirement of activeRequirements) {
      const start = timeToMinutes(requirement.start);
      const end = timeToMinutes(requirement.end);
      if (minute < start || minute >= end) continue;
      hasRequirement = true;
      requiredTotal = Math.max(requiredTotal, requirement.requiredTotal);
      for (const type of EMPLOYMENT_TYPES) {
        requiredByType[type.code] = Math.max(requiredByType[type.code], requirement.requiredByType[type.code]);
      }
    }

    const totalShort = Math.max(0, requiredTotal - (coverage[index] ?? 0));
    const byTypeShort = {};
    let anyShort = totalShort > 0;
    for (const type of EMPLOYMENT_TYPES) {
      const short = Math.max(0, requiredByType[type.code] - (coverageByType[type.code]?.[index] ?? 0));
      byTypeShort[type.code] = short;
      if (short > 0) anyShort = true;
    }
    return { requiredTotal, requiredByType, totalShort, byTypeShort, hasRequirement, anyShort };
  });

  // メッセージはバンド単位に集約する。セルの赤表示（perSlot）と整合するよう、
  // 各バンドの範囲内での最大不足人数を示す。
  const bandReports = activeRequirements.map((requirement) => {
    const start = timeToMinutes(requirement.start);
    const end = timeToMinutes(requirement.end);
    let maxTotalShort = 0;
    const maxByTypeShort = zeroByType();
    slots.forEach((minute, index) => {
      if (minute < start || minute >= end) return;
      maxTotalShort = Math.max(maxTotalShort, Math.max(0, requirement.requiredTotal - (coverage[index] ?? 0)));
      for (const type of EMPLOYMENT_TYPES) {
        maxByTypeShort[type.code] = Math.max(
          maxByTypeShort[type.code],
          Math.max(0, requirement.requiredByType[type.code] - (coverageByType[type.code]?.[index] ?? 0))
        );
      }
    });
    const ok = maxTotalShort === 0 && EMPLOYMENT_TYPES.every((type) => maxByTypeShort[type.code] === 0);
    return { requirement, maxTotalShort, maxByTypeShort, ok };
  });

  const messages = bandReports.filter((report) => !report.ok).map(formatBandMessage);

  return {
    hasAnyRequirement: activeRequirements.length > 0,
    perSlot,
    bandReports,
    messages,
    shortageSlotCount: perSlot.filter((slot) => slot.anyShort).length
  };
}

export { formatMinute };
