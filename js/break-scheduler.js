// 休憩配置の純粋ソルバー。
// 貪欲な初期配置のあと、全体目的関数（下記）を改善する移動を繰り返して
// 局所解から抜け出し、日全体で最適に近い配置を作る。
//
// 目的関数（辞書式・上から優先）：
//   1. 休憩を除いた実配置人数の最小値を最大化する（人が最も薄い瞬間を守る）
//   2. その最小値に落ちる時間帯の数を減らす
//   3. 同時に休憩する人数を平準化する（Σ 同時休憩数²を最小化）
//   4. 各休憩の目標時刻からのずれの合計を最小化する
//
// DOMやアプリ状態に依存しない。入出力はすべて分単位の数値。
export const BREAK_SLOT_MINUTES = 15;

const MAX_IMPROVEMENT_SWEEPS = 4;
// 始業から最初の休憩、および休憩同士に空ける最短間隔。
const MINIMUM_GAP_MINUTES = 60;
// 最後の休憩の終わりから終業までに残す最短間隔。
const MINIMUM_TAIL_MINUTES = 45;

function alignDown(minute) {
  return Math.floor(minute / BREAK_SLOT_MINUTES) * BREAK_SLOT_MINUTES;
}

function alignRound(minute) {
  return Math.round(minute / BREAK_SLOT_MINUTES) * BREAK_SLOT_MINUTES;
}

function slotsBetween(startMinute, endMinute) {
  const slots = [];
  for (let minute = alignDown(startMinute); minute < endMinute; minute += BREAK_SLOT_MINUTES) {
    slots.push(minute);
  }
  return slots;
}

function addLoad(load, startMinute, endMinute, delta) {
  for (const slot of slotsBetween(startMinute, endMinute)) {
    const next = (load.get(slot) ?? 0) + delta;
    if (next === 0) load.delete(slot);
    else load.set(slot, next);
  }
}

function candidateStarts(earliest, latest, target) {
  const first = Math.ceil(earliest / BREAK_SLOT_MINUTES) * BREAK_SLOT_MINUTES;
  const candidates = [];
  for (let slot = first; slot <= latest; slot += BREAK_SLOT_MINUTES) candidates.push(slot);
  if (!candidates.length) {
    // 制約を満たすグリッド位置がない短い勤務では、目標へ最も近い位置に丸めて置く。
    candidates.push(Math.max(earliest, Math.min(latest, alignRound(target))));
  }
  return candidates;
}

function isBetterScore(candidate, incumbent) {
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== incumbent[index]) return candidate[index] < incumbent[index];
  }
  return false;
}

// assignments: [{ id, shiftStart, shiftEnd, movable, templates, existingBreaks }]
// - movable=true の従業員は templates（type/label/duration/targetOffset）を配置する
// - movable=false の従業員は existingBreaks（{startMinute,endMinute}）を固定負荷として尊重する
// 返り値: Map(id -> [{ type, label, startMinute, endMinute }])
export function scheduleBreaks(assignments) {
  const active = new Map();
  for (const assignment of assignments) {
    for (const slot of slotsBetween(assignment.shiftStart, assignment.shiftEnd)) {
      active.set(slot, (active.get(slot) ?? 0) + 1);
    }
  }
  const activeSlots = [...active.entries()]
    .map(([slot, count]) => ({ slot, count }))
    .sort((a, b) => a.slot - b.slot);

  const load = new Map();
  for (const assignment of assignments) {
    if (assignment.movable) continue;
    for (const breakItem of assignment.existingBreaks ?? []) {
      addLoad(load, breakItem.startMinute, breakItem.endMinute, 1);
    }
  }

  const placements = new Map();
  const movable = assignments.filter((assignment) => assignment.movable);
  for (const assignment of movable) placements.set(assignment.id, []);

  const breakItems = [];
  const deviations = [];

  function evaluate() {
    let minimumCoverage = Number.POSITIVE_INFINITY;
    let slotsAtMinimum = 0;
    let loadPenalty = 0;
    for (const { slot, count } of activeSlots) {
      const onBreak = load.get(slot) ?? 0;
      const coverage = count - onBreak;
      if (coverage < minimumCoverage) {
        minimumCoverage = coverage;
        slotsAtMinimum = 1;
      } else if (coverage === minimumCoverage) {
        slotsAtMinimum += 1;
      }
      loadPenalty += onBreak * onBreak;
    }
    let totalDeviation = 0;
    for (const value of deviations) totalDeviation += value;
    return [-minimumCoverage, slotsAtMinimum, loadPenalty, totalDeviation];
  }

  function scoreCandidate(item, startMinute) {
    addLoad(load, startMinute, startMinute + item.duration, 1);
    const saved = deviations[item.deviationIndex];
    deviations[item.deviationIndex] = Math.abs(startMinute - item.target);
    const score = evaluate();
    deviations[item.deviationIndex] = saved;
    addLoad(load, startMinute, startMinute + item.duration, -1);
    return score;
  }

  // --- 貪欲初期配置：シフト順に、その時点の全体スコアが最良の位置へ置く。
  for (const assignment of movable) {
    const placed = placements.get(assignment.id);
    assignment.templates.forEach((template, index) => {
      const target = assignment.shiftStart + template.targetOffset;
      const reserved = assignment.templates
        .slice(index + 1)
        .reduce((sum, item) => sum + item.duration + MINIMUM_GAP_MINUTES, 0);
      const previousEnd = index > 0
        ? placed[index - 1].startMinute + assignment.templates[index - 1].duration
        : assignment.shiftStart;
      const earliest = Math.max(assignment.shiftStart, previousEnd) + MINIMUM_GAP_MINUTES;
      const latest = Math.max(
        earliest,
        assignment.shiftEnd - template.duration - Math.max(MINIMUM_TAIL_MINUTES, reserved)
      );

      const item = {
        assignment,
        index,
        duration: template.duration,
        target,
        deviationIndex: deviations.length
      };
      deviations.push(0);

      let bestStart = null;
      let bestScore = null;
      for (const candidate of candidateStarts(earliest, latest, target)) {
        const score = scoreCandidate(item, candidate);
        if (bestScore === null || isBetterScore(score, bestScore)) {
          bestScore = score;
          bestStart = candidate;
        }
      }

      placed.push({ startMinute: bestStart });
      deviations[item.deviationIndex] = Math.abs(bestStart - target);
      addLoad(load, bestStart, bestStart + template.duration, 1);
      breakItems.push(item);
    });
  }

  // --- 反復改善：1休憩ずつ全体スコアが厳密に良くなる位置へ動かす。
  // 厳密改善のみ受け入れるため必ず停止する。念のため走査回数にも上限を置く。
  let improved = true;
  for (let sweep = 0; improved && sweep < MAX_IMPROVEMENT_SWEEPS; sweep += 1) {
    improved = false;
    for (const item of breakItems) {
      const { assignment, index, duration, target } = item;
      const placed = placements.get(assignment.id);
      const previousEnd = index > 0
        ? placed[index - 1].startMinute + assignment.templates[index - 1].duration
        : assignment.shiftStart;
      const earliest = Math.max(assignment.shiftStart, previousEnd) + MINIMUM_GAP_MINUTES;
      const nextStart = index < placed.length - 1 ? placed[index + 1].startMinute : null;
      const latest = Math.max(
        earliest,
        (nextStart !== null ? nextStart - MINIMUM_GAP_MINUTES : assignment.shiftEnd - MINIMUM_TAIL_MINUTES) - duration
      );

      const current = placed[index].startMinute;
      addLoad(load, current, current + duration, -1);

      let bestStart = current;
      let bestScore = scoreCandidate(item, current);
      for (const candidate of candidateStarts(earliest, latest, target)) {
        if (candidate === current) continue;
        const score = scoreCandidate(item, candidate);
        if (isBetterScore(score, bestScore)) {
          bestScore = score;
          bestStart = candidate;
        }
      }

      addLoad(load, bestStart, bestStart + duration, 1);
      if (bestStart !== current) {
        placed[index].startMinute = bestStart;
        deviations[item.deviationIndex] = Math.abs(bestStart - target);
        improved = true;
      }
    }
  }

  const result = new Map();
  for (const assignment of assignments) {
    if (!assignment.movable) continue;
    const placed = placements.get(assignment.id) ?? [];
    result.set(assignment.id, (assignment.templates ?? []).map((template, index) => ({
      type: template.type,
      label: template.label,
      startMinute: placed[index].startMinute,
      endMinute: placed[index].startMinute + template.duration
    })));
  }
  return result;
}
