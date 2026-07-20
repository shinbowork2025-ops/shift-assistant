// 既存画面向けの互換ラッパー。
// 実際の候補生成・日別最適化は次世代ソルバーと共通の純粋実装を使用する。
import { placeBreaksForDay } from "./solver/break-placement.js";

export const BREAK_SLOT_MINUTES = 15;

function policyFromAssignment(assignment) {
  const templates = assignment.movable
    ? (assignment.templates ?? [])
    : (assignment.existingBreaks ?? []).map((item, index) => ({
      type: item.type ?? (index === 0 ? "lunch" : "small"),
      label: item.label,
      duration: item.endMinute - item.startMinute,
      targetOffset: item.startMinute - assignment.shiftStart
    }));
  return {
    totalMinutes: templates.reduce((sum, item) => sum + Number(item.duration || 0), 0),
    segments: templates.map((item) => ({
      type: item.type,
      label: item.label,
      duration: item.duration,
      targetOffset: item.targetOffset
    }))
  };
}

// assignments: [{ id, shiftStart, shiftEnd, movable, templates, existingBreaks }]
// 返り値: Map(id -> [{ type, label, startMinute, endMinute }])
export function scheduleBreaks(assignments) {
  const fixedBreaks = {};
  const normalized = assignments.map((assignment, index) => {
    if (!assignment.movable) fixedBreaks[assignment.id] = assignment.existingBreaks ?? [];
    return {
      id: assignment.id,
      displayOrder: index,
      shiftType: {
        code: assignment.id,
        isDayOff: false,
        startMinutes: assignment.shiftStart,
        endMinutes: assignment.shiftEnd,
        breakPolicy: policyFromAssignment(assignment)
      }
    };
  });
  const result = placeBreaksForDay({
    assignments: normalized,
    fixedBreaks,
    maxCandidatesPerAssignment: 128,
    localImprovementSweeps: 1,
    enablePairImprovement: false
  });
  return new Map(assignments
    .filter((assignment) => assignment.movable)
    .map((assignment) => [assignment.id, result.placements[assignment.id] ?? []]));
}
