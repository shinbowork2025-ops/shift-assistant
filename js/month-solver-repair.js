import { compareStatutoryVectors } from "./month-solver-control.js";
import { evaluateMonthSolverChanges } from "./month-solver-score.js";

export const REPAIR_CELL_CAP = 12;
export const BRUTE_CELL_CAP = 8;
export const BRUTE_COMBO_CAP = 20_000;
export const DEFAULT_BEAM_WIDTH = 30;

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
    Math.floor(Number(options.cellCount ?? 4) || 4)
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
  cells,
  choicesByCell,
  beamWidth,
  fixedCells = [],
  fixedChoices = []
) {
  let evaluatedCandidates = 0;
  let beam = [{ choices: [], evaluation: null }];
  for (let index = 0; index < cells.length; index += 1) {
    const next = [];
    for (const state of beam) {
      for (const choice of choicesByCell[index]) {
        const choices = [...state.choices, choice];
        const partialCells = cells.slice(0, index + 1);
        const evaluation = evaluateChoices(
          context,
          partialCells,
          choices,
          fixedCells,
          fixedChoices
        );
        if (!evaluation) {
          if (choices.every((value, choiceIndex) => value === currentCode(context.plan, partialCells[choiceIndex]))) {
            next.push({ choices, evaluation: null });
          }
          continue;
        }
        evaluatedCandidates += 1;
        next.push({ choices, evaluation });
      }
    }
    next.sort((left, right) => {
      if (!left.evaluation) return 1;
      if (!right.evaluation) return -1;
      return compareEvaluations(left.evaluation, right.evaluation);
    });
    beam = next.slice(0, beamWidth);
    if (!beam.length) break;
  }
  const completed = beam
    .map((state) => state.evaluation ?? evaluateChoices(
      context,
      cells,
      state.choices,
      fixedCells,
      fixedChoices
    ))
    .filter(Boolean)
    .sort(compareEvaluations);
  return { method: "beam", evaluation: completed[0] ?? null, evaluatedCandidates };
}

function greedyRepair(context, cells, choicesByCell) {
  let evaluatedCandidates = 0;
  const choices = [];
  for (let index = 0; index < cells.length; index += 1) {
    let best = null;
    let bestChoice = choicesByCell[index][0];
    for (const choice of choicesByCell[index]) {
      const candidateChoices = [...choices, choice];
      const evaluation = evaluateChoices(
        context,
        cells.slice(0, index + 1),
        candidateChoices
      );
      if (!evaluation) {
        if (choice === currentCode(context.plan, cells[index])) {
          best ??= {
            objective: context.objective,
            changes: [],
            choices: candidateChoices
          };
        }
        continue;
      }
      evaluatedCandidates += 1;
      if (compareEvaluations(evaluation, best) < 0) {
        best = evaluation;
        bestChoice = choice;
      }
    }
    choices.push(bestChoice);
  }
  return { choices, evaluatedCandidates };
}

function greedyBeamRepair(context, cells, choicesByCell, beamWidth) {
  const greedy = greedyRepair(context, cells, choicesByCell);
  const windowCells = cells.slice(0, REPAIR_CELL_CAP);
  const windowChoices = choicesByCell.slice(0, REPAIR_CELL_CAP);
  const fixedCells = cells.slice(REPAIR_CELL_CAP);
  const fixedChoices = greedy.choices.slice(REPAIR_CELL_CAP);
  const beam = beamRepair(
    context,
    windowCells,
    windowChoices,
    beamWidth,
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
  const useBrute = cells.length <= BRUTE_CELL_CAP && combinationCount <= BRUTE_COMBO_CAP;
  const beamWidth = Math.max(
    1,
    Math.floor(Number(options.beamWidth ?? DEFAULT_BEAM_WIDTH) || DEFAULT_BEAM_WIDTH)
  );
  const result = cells.length > REPAIR_CELL_CAP
    ? greedyBeamRepair(context, cells, choicesByCell, beamWidth)
    : useBrute
      ? bruteRepair(context, cells, choicesByCell)
      : beamRepair(
      context,
      cells,
      choicesByCell,
      beamWidth
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
