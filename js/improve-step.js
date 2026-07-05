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
  return { plan, improved, order, context, currentCandidates, candidatesByEmployee, config };
}
