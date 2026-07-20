import { compareStatutoryVectors } from "./month-solver-control.js";
import { evaluateMonthSolverChanges } from "./month-solver-score.js";
import { timeToMinutes } from "./date-time.js";

export const REPAIR_CELL_CAP = 12;
export const BRUTE_CELL_CAP = 8;
export const BRUTE_COMBO_CAP = 20_000;
export const DEFAULT_BEAM_WIDTH = 30;
export const DEFAULT_EXACT_CANDIDATE_CAP = 3;

function currentCode(plan, cell) {
  return plan.assignments?.[cell.employeeId]?.[cell.day] ?? "";
}

function workState(source, code) {
  const shiftType = source.typeMap.get(code);
  return shiftType ? Boolean(shiftType.isWork) : null;
}

function optionsForCell(plan, source, cell) {
  const current = currentCode(plan, cell);
  const currentState = workState(source, current);
  return [...new Set([current, ...(plan.allowedCodes?.[cell.employeeId] ?? [])
    .filter((code) => code !== current)
    .filter((code) => workState(source, code) === currentState)])];
}

function metricPriority(context, cell) {
  const dayMetric = context.dayMetrics.get(cell.day);
  const employeeMetric = context.employeeMetrics.get(cell.employeeId);
  return (Number(dayMetric?.shortagePeople) || 0) * 1_000_000
    + (Number(dayMetric?.shortageSlots) || 0) * 10_000
    + (Number(employeeMetric?.internalViolationCount) || 0) * 1_000
    + (Number(employeeMetric?.hardViolations) || 0) * 100
    + (Number(employeeMetric?.overtimeExcess) || 0);
}

function compareRepairCellPriority(context, left, right) {
  return metricPriority(context, right) - metricPriority(context, left)
    || left.day - right.day
    || String(left.employeeId).localeCompare(String(right.employeeId));
}

export function selectRepairCells(context, source, options = {}) {
  const requested = Math.max(1, Math.min(
    REPAIR_CELL_CAP,
    Math.floor(Number(options.cellCount ?? 3) || 3)
  ));
  return [...source.mutableCells]
    .filter((cell) => optionsForCell(context.plan, source, cell).length >= 2)
    .sort((left, right) => compareRepairCellPriority(context, left, right))
    .slice(0, requested);
}

function changesForChoices(plan, cells, choices) {
  const changes = [];
  for (let index = 0; index < cells.length; index += 1) {
    const before = currentCode(plan, cells[index]);
    const after = choices[index];
    if (before !== after) changes.push({ ...cells[index], before, after });
  }
  return changes;
}

function compareEvaluations(first, second) {
  if (!second) return -1;
  const statutory = compareStatutoryVectors(first.objective, second.objective);
  if (statutory !== 0) return statutory;
  const keys = ["internalViolationCount", "internalViolationAmount"];
  for (const key of keys) {
    const difference = (Number(first.objective?.[key]) || 0) - (Number(second.objective?.[key]) || 0);
    if (difference !== 0) return difference;
  }
  const score = Number(first.objective.scalar) - Number(second.objective.scalar);
  if (score !== 0) return score;
  if (first.changes.length !== second.changes.length) return first.changes.length - second.changes.length;
  return JSON.stringify(first.changes).localeCompare(JSON.stringify(second.changes));
}

function evaluateChoices(context, cells, choices, fixedCells = [], fixedChoices = []) {
  const changes = [
    ...changesForChoices(context.plan, fixedCells, fixedChoices),
    ...changesForChoices(context.plan, cells, choices)
  ];
  if (!changes.length) return null;
  const evaluation = evaluateMonthSolverChanges(context, changes);
  return evaluation ? { ...evaluation, choices: [...choices] } : null;
}

function coversSlot(source, code, slotIndex) {
  const shift = source.typeMap.get(code);
  if (!shift?.isWork) return false;
  const start = timeToMinutes(shift.start);
  const end = timeToMinutes(shift.end);
  const minute = slotIndex * 15;
  return start !== null && end !== null && minute >= start && minute < end;
}

function choiceHeuristic(context, source, cell, choice) {
  const before = currentCode(context.plan, cell);
  if (choice === before) return 0;
  const shortage = context.dayMetrics.get(cell.day)?.shortageBySlot ?? [];
  let relief = 0;
  for (let slot = 0; slot < shortage.length; slot += 1) {
    const need = Number(shortage[slot]) || 0;
    if (need <= 0) continue;
    relief += need * (
      Number(coversSlot(source, choice, slot))
      - Number(coversSlot(source, before, slot))
    );
  }
  const original = context.plan.originalAssignments?.[cell.employeeId]?.[cell.day] ?? "";
  const changePenalty = choice === original ? 0 : 1;
  return -(relief * 1_000_000) + changePenalty * 100 + 1;
}

function choicesHeuristic(context, source, cells, choices) {
  return choices.reduce((sum, choice, index) => (
    sum + choiceHeuristic(context, source, cells[index], choice)
  ), 0);
}

function bruteRepair(context, cells, choicesByCell) {
  let evaluatedCandidates = 0;
  let best = null;
  const choices = [];
  function visit(index) {
    if (index === cells.length) {
      const evaluation = evaluateChoices(context, cells, choices);
      if (!evaluation) return;
      evaluatedCandidates += 1;
      if (compareEvaluations(evaluation, best) < 0) best = evaluation;
      return;
    }
    for (const choice of choicesByCell[index]) {
      choices.push(choice);
      visit(index + 1);
      choices.pop();
    }
  }
  visit(0);
  return { method: "brute", evaluation: best, evaluatedCandidates };
}

function beamRepair(
  context,
  source,
  cells,
  choicesByCell,
  beamWidth,
  exactCandidateCap,
  fixedCells = [],
  fixedChoices = []
) {
  let evaluatedCandidates = 0;
  let beam = [{ choices: [], heuristic: 0 }];
  for (let index = 0; index < cells.length; index += 1) {
    const next = [];
    for (const state of beam) {
      for (const choice of choicesByCell[index]) {
        const choices = [...state.choices, choice];
        const partialCells = cells.slice(0, index + 1);
        next.push({
          choices,
          heuristic: choicesHeuristic(context, source, partialCells, choices)
        });
      }
    }
    next.sort((left, right) => {
      const difference = left.heuristic - right.heuristic;
      return difference || JSON.stringify(left.choices).localeCompare(JSON.stringify(right.choices));
    });
    beam = next.slice(0, beamWidth);
    if (!beam.length) break;
  }
  const completed = beam
    .filter((state) => [
      ...changesForChoices(context.plan, fixedCells, fixedChoices),
      ...changesForChoices(context.plan, cells, state.choices)
    ].length > 0)
    .slice(0, exactCandidateCap)
    .map((state) => {
      const evaluation = evaluateChoices(
        context,
        cells,
        state.choices,
        fixedCells,
        fixedChoices
      );
      if (evaluation) evaluatedCandidates += 1;
      return evaluation;
    })
    .filter(Boolean)
    .sort(compareEvaluations);
  return { method: "beam", evaluation: completed[0] ?? null, evaluatedCandidates };
}

function greedyRepair(context, source, cells, choicesByCell) {
  const choices = [];
  for (let index = 0; index < cells.length; index += 1) {
    const ranked = [...choicesByCell[index]].sort((left, right) => (
      choiceHeuristic(context, source, cells[index], left)
      - choiceHeuristic(context, source, cells[index], right)
      || String(left).localeCompare(String(right))
    ));
    choices.push(ranked[0]);
  }
  return { choices, evaluatedCandidates: 0 };
}

function greedyBeamRepair(
  context,
  source,
  cells,
  choicesByCell,
  beamWidth,
  exactCandidateCap
) {
  const greedy = greedyRepair(context, source, cells, choicesByCell);
  const windowCells = cells.slice(0, REPAIR_CELL_CAP);
  const windowChoices = choicesByCell.slice(0, REPAIR_CELL_CAP);
  const fixedCells = cells.slice(REPAIR_CELL_CAP);
  const fixedChoices = greedy.choices.slice(REPAIR_CELL_CAP);
  const beam = beamRepair(
    context,
    source,
    windowCells,
    windowChoices,
    beamWidth,
    exactCandidateCap,
    fixedCells,
    fixedChoices
  );
  return {
    method: "greedyBeam",
    evaluation: beam.evaluation,
    evaluatedCandidates: greedy.evaluatedCandidates + beam.evaluatedCandidates
  };
}

function requestedRepairCells(context, source, options) {
  if (!Array.isArray(options.cells)) return selectRepairCells(context, source, options);
  const mutable = new Set(source.mutableCells.map((cell) => `${cell.employeeId}:${cell.day}`));
  const seen = new Set();
  return options.cells.filter((cell) => {
    const key = `${cell?.employeeId}:${cell?.day}`;
    if (seen.has(key) || !mutable.has(key)) return false;
    seen.add(key);
    return optionsForCell(context.plan, source, cell).length >= 2;
  }).sort((left, right) => compareRepairCellPriority(context, left, right));
}

export function proposeMonthSolverRepair(context, source, options = {}) {
  const cells = requestedRepairCells(context, source, options);
  if (!cells.length) return null;
  const choicesByCell = cells.map((cell) => optionsForCell(context.plan, source, cell));
  const combinationCount = choicesByCell.reduce((product, choices) => (
    product > Number.MAX_SAFE_INTEGER / choices.length
      ? Number.POSITIVE_INFINITY
      : product * choices.length
  ), 1);
  const useBrute = options.forceBeam !== true
    && cells.length <= BRUTE_CELL_CAP
    && combinationCount <= BRUTE_COMBO_CAP;
  const beamWidth = Math.max(
    1,
    Math.floor(Number(options.beamWidth ?? DEFAULT_BEAM_WIDTH) || DEFAULT_BEAM_WIDTH)
  );
  const exactCandidateCap = Math.max(
    1,
    Math.min(
      beamWidth,
      Math.floor(Number(options.exactCandidateCap ?? DEFAULT_EXACT_CANDIDATE_CAP)
        || DEFAULT_EXACT_CANDIDATE_CAP)
    )
  );
  const result = cells.length > REPAIR_CELL_CAP
    ? greedyBeamRepair(context, source, cells, choicesByCell, beamWidth, exactCandidateCap)
    : useBrute
      ? bruteRepair(context, cells, choicesByCell)
      : beamRepair(
      context,
      source,
      cells,
      choicesByCell,
      beamWidth,
      exactCandidateCap
    );
  if (!result.evaluation) return null;
  return {
    strategy: "repair",
    method: result.method,
    cells,
    combinationCount,
    evaluatedCandidates: result.evaluatedCandidates,
    evaluation: result.evaluation,
    changes: result.evaluation.changes
  };
}
