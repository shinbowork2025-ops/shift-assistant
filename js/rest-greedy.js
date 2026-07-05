export function generateGreedyRestPlan(dayPlan) {
  return Object.fromEntries((dayPlan?.employees ?? []).map((employee) => [employee.id, []]));
}
