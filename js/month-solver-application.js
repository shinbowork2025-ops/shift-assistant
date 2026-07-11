import { scoreMonthSolverPlan, validateMonthSolverPlan } from "./month-solver-score.js";

function assignmentCode(plan, employeeId, day) {
  return plan.assignments?.[employeeId]?.[day] ?? "";
}

function daysOffCount(plan, employeeId, typeMap) {
  let count = 0;
  for (let day = 1; day <= plan.daysInMonth; day += 1) {
    const shiftType = typeMap.get(assignmentCode(plan, employeeId, day));
    if (shiftType && !shiftType.isWork) count += 1;
  }
  return count;
}

function uniqueMessages(messages) {
  return [...new Set(messages.filter(Boolean))];
}

export function validateMonthSolverApplication(result) {
  const plan = result?.plan;
  if (!plan) {
    return {
      ok: false,
      structuralOk: false,
      daysOffOk: false,
      constraintsOk: false,
      coverageOk: false,
      issues: ["月間シフト案がありません。"]
    };
  }

  const structural = result.validation ?? validateMonthSolverPlan(plan);
  const objective = result.objective ?? scoreMonthSolverPlan(plan);
  const issues = [...(structural.issues ?? [])];
  const typeMap = new Map(plan.shiftTypes.map((shiftType) => [shiftType.code, shiftType]));
  const selectedIds = new Set(plan.selectedEmployeeIds ?? plan.employees.map((employee) => employee.id));
  const daysOffIssues = [];

  for (const employee of plan.employees) {
    if (!selectedIds.has(employee.id)) continue;
    const target = Math.max(0, Number(plan.targetDaysOffByEmployee?.[employee.id]) || 0);
    const actual = daysOffCount(plan, employee.id, typeMap);
    if (actual !== target) {
      daysOffIssues.push(`${employee.name}さんの休日数が目標${target}日に対して${actual}日です。`);
    }
  }
  issues.push(...daysOffIssues);

  const constraintsOk = Number(objective.hard) === 0;
  if (!constraintsOk) {
    issues.push(`勤務間隔・連続勤務の違反が${objective.hard}件残っています。`);
  }

  const coverageOk = Number(objective.shortagePeople) === 0 && Number(objective.shortageSlots) === 0;
  if (!coverageOk) {
    issues.push(`必要人数不足が${objective.shortagePeople}人枠、${objective.shortageSlots}時間帯残っています。`);
  }

  const structuralOk = Boolean(structural.ok);
  if (!structuralOk && !(structural.issues?.length)) {
    issues.push("固定セルまたは使用可能なシフト区分に矛盾があります。");
  }

  const daysOffOk = daysOffIssues.length === 0;
  const normalizedIssues = uniqueMessages(issues);
  return {
    ok: structuralOk && daysOffOk && constraintsOk && coverageOk,
    structuralOk,
    daysOffOk,
    constraintsOk,
    coverageOk,
    objective,
    issues: normalizedIssues
  };
}
