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
const MAX_REQUIREMENTS = 50;
const COVERAGE_SLOT_MINUTES = 15;

function nonNegativeInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(MAX_REQUIRED, Math.max(0, Math.round(number)));
}

function cleanLabel(value) {
  return typeof value === "string" ? value.trim().slice(0, 40) : "";
}

function zeroByType() {
  return Object.fromEntries(EMPLOYMENT_TYPES.map((type) => [type.code, 0]));
}

function slotOverlapsRequirement(slotStart, requirementStart, requirementEnd) {
  const slotEnd = slotStart + COVERAGE_SLOT_MINUTES;
  return slotStart < requirementEnd && slotEnd > requirementStart;
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
    requiredByType,
    requiredDepartment: cleanLabel(candidate?.requiredDepartment),
    requiredDepartmentCount: nonNegativeInt(candidate?.requiredDepartmentCount),
    requiredQualification: cleanLabel(candidate?.requiredQualification),
    requiredQualificationCount: nonNegativeInt(candidate?.requiredQualificationCount)
  };
}

export function normalizeCoverageRequirements(candidate) {
  return (Array.isArray(candidate) ? candidate : [])
    .slice(0, MAX_REQUIREMENTS)
    .map((item, index) => normalizeCoverageRequirement(item, index));
}

export function requirementIsActive(requirement) {
  const start = timeToMinutes(requirement?.start);
  const end = timeToMinutes(requirement?.end);
  if (start === null || end === null || end <= start) return false;
  if (requirement.requiredTotal > 0) return true;
  if (EMPLOYMENT_TYPES.some((type) => requirement.requiredByType[type.code] > 0)) return true;
  if (requirement.requiredDepartment && requirement.requiredDepartmentCount > 0) return true;
  return Boolean(requirement.requiredQualification && requirement.requiredQualificationCount > 0);
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
  if (report.maxDepartmentShort > 0) {
    parts.push(`${report.requirement.requiredDepartment}${report.maxDepartmentShort}人不足`);
  }
  if (report.maxQualificationShort > 0) {
    parts.push(`${report.requirement.requiredQualification}資格者${report.maxQualificationShort}人不足`);
  }
  return `${report.requirement.start}〜${report.requirement.end}：${parts.join(" / ")}`;
}

function mapMaximum(target, key, value) {
  if (!key || value <= 0) return;
  target[key] = Math.max(target[key] ?? 0, value);
}

export function evaluateCoverage({
  activeRequirements = [],
  slots = [],
  coverage = [],
  coverageByType = {},
  coverageByDepartment = {},
  coverageByQualification = {}
}) {
  const perSlot = slots.map((minute, index) => {
    let requiredTotal = 0;
    const requiredByType = zeroByType();
    const requiredByDepartment = {};
    const requiredByQualification = {};
    let hasRequirement = false;

    for (const requirement of activeRequirements) {
      const start = timeToMinutes(requirement.start);
      const end = timeToMinutes(requirement.end);
      if (!slotOverlapsRequirement(minute, start, end)) continue;
      hasRequirement = true;
      requiredTotal = Math.max(requiredTotal, requirement.requiredTotal);
      for (const type of EMPLOYMENT_TYPES) {
        requiredByType[type.code] = Math.max(requiredByType[type.code], requirement.requiredByType[type.code]);
      }
      mapMaximum(requiredByDepartment, requirement.requiredDepartment, requirement.requiredDepartmentCount);
      mapMaximum(requiredByQualification, requirement.requiredQualification, requirement.requiredQualificationCount);
    }

    const totalShort = Math.max(0, requiredTotal - (coverage[index] ?? 0));
    const byTypeShort = {};
    const byDepartmentShort = {};
    const byQualificationShort = {};
    for (const type of EMPLOYMENT_TYPES) {
      byTypeShort[type.code] = Math.max(0, requiredByType[type.code] - (coverageByType[type.code]?.[index] ?? 0));
    }
    for (const [department, required] of Object.entries(requiredByDepartment)) {
      byDepartmentShort[department] = Math.max(0, required - (coverageByDepartment[department]?.[index] ?? 0));
    }
    for (const [qualification, required] of Object.entries(requiredByQualification)) {
      byQualificationShort[qualification] = Math.max(0, required - (coverageByQualification[qualification]?.[index] ?? 0));
    }

    const typeShortTotal = Object.values(byTypeShort).reduce((sum, value) => sum + value, 0);
    const departmentShortTotal = Object.values(byDepartmentShort).reduce((sum, value) => sum + value, 0);
    const qualificationShortTotal = Object.values(byQualificationShort).reduce((sum, value) => sum + value, 0);
    const shortagePeople = Math.max(totalShort, typeShortTotal, departmentShortTotal, qualificationShortTotal);
    return {
      requiredTotal,
      requiredByType,
      requiredByDepartment,
      requiredByQualification,
      totalShort,
      byTypeShort,
      byDepartmentShort,
      byQualificationShort,
      shortagePeople,
      hasRequirement,
      anyShort: shortagePeople > 0
    };
  });

  const bandReports = activeRequirements.map((requirement) => {
    const start = timeToMinutes(requirement.start);
    const end = timeToMinutes(requirement.end);
    let maxTotalShort = 0;
    const maxByTypeShort = zeroByType();
    let maxDepartmentShort = 0;
    let maxQualificationShort = 0;
    slots.forEach((minute, index) => {
      if (!slotOverlapsRequirement(minute, start, end)) return;
      maxTotalShort = Math.max(maxTotalShort, Math.max(0, requirement.requiredTotal - (coverage[index] ?? 0)));
      for (const type of EMPLOYMENT_TYPES) {
        maxByTypeShort[type.code] = Math.max(
          maxByTypeShort[type.code],
          Math.max(0, requirement.requiredByType[type.code] - (coverageByType[type.code]?.[index] ?? 0))
        );
      }
      if (requirement.requiredDepartment) {
        maxDepartmentShort = Math.max(
          maxDepartmentShort,
          Math.max(0, requirement.requiredDepartmentCount - (coverageByDepartment[requirement.requiredDepartment]?.[index] ?? 0))
        );
      }
      if (requirement.requiredQualification) {
        maxQualificationShort = Math.max(
          maxQualificationShort,
          Math.max(0, requirement.requiredQualificationCount - (coverageByQualification[requirement.requiredQualification]?.[index] ?? 0))
        );
      }
    });
    const ok = maxTotalShort === 0
      && EMPLOYMENT_TYPES.every((type) => maxByTypeShort[type.code] === 0)
      && maxDepartmentShort === 0
      && maxQualificationShort === 0;
    return { requirement, maxTotalShort, maxByTypeShort, maxDepartmentShort, maxQualificationShort, ok };
  });

  const messages = bandReports.filter((report) => !report.ok).map(formatBandMessage);
  return {
    hasAnyRequirement: activeRequirements.length > 0,
    perSlot,
    bandReports,
    messages,
    shortageSlotCount: perSlot.filter((slot) => slot.anyShort).length,
    shortagePeople: perSlot.reduce((sum, slot) => sum + slot.shortagePeople, 0)
  };
}

export { formatMinute };
