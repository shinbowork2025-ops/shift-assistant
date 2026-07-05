import { plannedBreakTemplates } from "./break-rules.js";
import { breakSlots, nearbyStarts } from "./break-grid.js";

function addLoad(items, load) {
  for (const item of items ?? []) {
    const duration = Number(item.end) - Number(item.start);
    for (const slot of breakSlots(Number(item.start), duration)) {
      load.set(slot, (load.get(slot) ?? 0) + 1);
    }
  }
}

function chooseStart(target, earliest, latest, duration, active, load) {
  let best = earliest;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const start of nearbyStarts(target, earliest, latest)) {
    let minimumAvailable = Number.POSITIVE_INFINITY;
    let concurrent = 0;
    for (const slot of breakSlots(start, duration)) {
      minimumAvailable = Math.min(minimumAvailable, (active.get(slot) ?? 0) - (load.get(slot) ?? 0) - 1);
      concurrent += load.get(slot) ?? 0;
    }
    const candidateScore = -minimumAvailable * 1000 + concurrent * 100 + Math.abs(start - target);
    if (candidateScore < bestScore) {
      best = start;
      bestScore = candidateScore;
    }
  }
  return best;
}

function templatesAfterLocked(span, locked) {
  const templates = plannedBreakTemplates(span).map((item) => ({ ...item }));
  // ロック済み休憩が確保している休憩時間を「予算」とみなし、その分だけ
  // テンプレートを取り除く。単純な同一長一致だと、既定テンプレートより長い
  // 休憩をロックした場合（例: 45分想定の勤務に60分をロック）にテンプレートが
  // 残り、二重に休憩が追加されて過剰配置になるため、長いテンプレートから
  // 予算で吸収して残りだけを初期配置する。
  let budget = locked.reduce(
    (sum, item) => sum + Math.max(0, Number(item.end) - Number(item.start)),
    0
  );
  const dropped = new Set();
  const byDurationDesc = templates
    .map((template, index) => ({ template, index }))
    .sort((a, b) => b.template.duration - a.template.duration || a.index - b.index);
  for (const { template, index } of byDurationDesc) {
    if (budget >= template.duration) {
      budget -= template.duration;
      dropped.add(index);
    }
  }
  return templates.filter((_, index) => !dropped.has(index));
}

export function generateGreedyRestPlan(dayPlan) {
  const employees = Array.isArray(dayPlan?.employees) ? [...dayPlan.employees] : [];
  employees.sort((a, b) => a.shiftStart - b.shiftStart || Number(a.order ?? 0) - Number(b.order ?? 0));
  const active = new Map();
  const load = new Map();
  const result = {};

  for (const employee of employees) {
    for (const slot of breakSlots(employee.shiftStart, employee.shiftEnd - employee.shiftStart)) {
      active.set(slot, (active.get(slot) ?? 0) + 1);
    }
    result[employee.id] = (employee.breaks ?? []).filter((item) => item.locked).map((item) => ({ ...item }));
    addLoad(result[employee.id], load);
  }

  for (const employee of employees) {
    const templates = templatesAfterLocked(employee.shiftEnd - employee.shiftStart, result[employee.id]);
    let previousEnd = employee.shiftStart;
    for (const item of result[employee.id]) previousEnd = Math.max(previousEnd, Number(item.end));

    templates.forEach((template, index) => {
      const target = employee.shiftStart + template.targetOffset;
      const reserve = templates.slice(index + 1).reduce((sum, item) => sum + item.duration + 60, 0);
      const earliest = Math.max(employee.shiftStart + 60, previousEnd + 60);
      const latest = Math.max(earliest, employee.shiftEnd - template.duration - Math.max(45, reserve));
      const start = chooseStart(target, earliest, latest, template.duration, active, load);
      const item = {
        type: template.type,
        label: template.label,
        start,
        end: start + template.duration,
        target,
        locked: false
      };
      result[employee.id].push(item);
      addLoad([item], load);
      previousEnd = item.end;
    });
    result[employee.id].sort((a, b) => a.start - b.start || a.end - b.end);
  }
  return result;
}
