import { checkHard } from "./scoring.js";
import { applyCompiledRest, evaluateCompiledRest } from "./rest-candidate.js";
import { shuffled } from "./rng.js";

const EPSILON = 1e-9;

function withEmployeeBreaks(dayPlan, employeeId, breaks) {
  return {
    ...dayPlan,
    employees: dayPlan.employees.map((employee) => employee.id === employeeId
      ? { ...employee, breaks: breaks.map((item) => ({ ...item })) }
      : employee)
  };
}

export function runStep(currentPlan, context, currentCandidates, candidatesByEmployee, random, config) {
  let plan = currentPlan;
  let improved = false;
  const order = shuffled(plan.employees.map((employee) => employee.id), random);

  for (const employeeId of order) {
    const employee = plan.employees.find((item) => item.id === employeeId);
    const previous = currentCandidates.get(employeeId);
    const candidates = candidatesByEmployee.get(employeeId) ?? [];
    const feasible = new Set(candidates.map((candidate) => candidate.signature));
    const forceReplacement = !feasible.has(previous.signature)
      || !checkHard({ employees: [employee] }, config).ok;
    let selected = null;
    let selectedEvaluation = null;

    for (const candidate of candidates) {
      const evaluation = evaluateCompiledRest(context, previous, candidate);
      if (
        selectedEvaluation === null
        || evaluation.total < selectedEvaluation.total - EPSILON
        || (Math.abs(evaluation.total - selectedEvaluation.total) <= EPSILON && candidate.signature < selected.signature)
      ) {
        selected = candidate;
        selectedEvaluation = evaluation;
      }
    }

    if (!selected || !selectedEvaluation) continue;
    if (forceReplacement || selectedEvaluation.total < context.result.total - EPSILON) {
      plan = withEmployeeBreaks(plan, employeeId, selected.items);
      applyCompiledRest(context, selectedEvaluation);
      currentCandidates.set(employeeId, selected);
      improved = true;
    }
  }

  return { plan, improved };
}
