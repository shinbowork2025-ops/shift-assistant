function isMutable(plan, employeeId, day) {
  return plan.fixedValues?.[employeeId]?.[day] === undefined;
}

function currentCode(plan, employeeId, day) {
  return plan.assignments?.[employeeId]?.[day] ?? "";
}

function pick(values, random) {
  if (!values.length) return null;
  return values[Math.floor(random() * values.length)];
}

export function createMonthNeighborSource(plan) {
  const selected = new Set(plan.selectedEmployeeIds ?? []);
  const mutableCells = [];
  const mutableByDay = new Map();
  const mutableByEmployee = new Map();

  for (const employee of plan.employees) {
    if (!selected.has(employee.id)) continue;
    for (let day = 1; day <= plan.daysInMonth; day += 1) {
      if (!isMutable(plan, employee.id, day)) continue;
      const cell = { employeeId: employee.id, day };
      mutableCells.push(cell);
      if (!mutableByDay.has(day)) mutableByDay.set(day, []);
      mutableByDay.get(day).push(cell);
      if (!mutableByEmployee.has(employee.id)) mutableByEmployee.set(employee.id, []);
      mutableByEmployee.get(employee.id).push(cell);
    }
  }
  return {
    mutableCells,
    mutableByDay,
    mutableByEmployee,
    daysWithPairs: [...mutableByDay.entries()].filter(([, cells]) => cells.length >= 2).map(([day]) => day),
    employeesWithPairs: [...mutableByEmployee.entries()].filter(([, cells]) => cells.length >= 2).map(([id]) => id)
  };
}

function singleCellChange(plan, source, random) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const cell = pick(source.mutableCells, random);
    if (!cell) return null;
    const current = currentCode(plan, cell.employeeId, cell.day);
    const candidates = (plan.allowedCodes?.[cell.employeeId] ?? []).filter((code) => code !== current);
    const after = pick(candidates, random);
    if (after) return [{ ...cell, after }];
  }
  return null;
}

function sameDaySwap(plan, source, random) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const day = pick(source.daysWithPairs, random);
    const cells = source.mutableByDay.get(day) ?? [];
    const first = pick(cells, random);
    const second = pick(cells.filter((cell) => cell.employeeId !== first?.employeeId), random);
    if (!first || !second) continue;
    const firstCode = currentCode(plan, first.employeeId, day);
    const secondCode = currentCode(plan, second.employeeId, day);
    if (!firstCode || !secondCode || firstCode === secondCode) continue;
    if (!(plan.allowedCodes[first.employeeId] ?? []).includes(secondCode)) continue;
    if (!(plan.allowedCodes[second.employeeId] ?? []).includes(firstCode)) continue;
    return [
      { employeeId: first.employeeId, day, after: secondCode },
      { employeeId: second.employeeId, day, after: firstCode }
    ];
  }
  return null;
}

function sameEmployeeSwap(plan, source, random) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const employeeId = pick(source.employeesWithPairs, random);
    const cells = source.mutableByEmployee.get(employeeId) ?? [];
    const first = pick(cells, random);
    const second = pick(cells.filter((cell) => cell.day !== first?.day), random);
    if (!first || !second) continue;
    const firstCode = currentCode(plan, employeeId, first.day);
    const secondCode = currentCode(plan, employeeId, second.day);
    if (!firstCode || !secondCode || firstCode === secondCode) continue;
    return [
      { employeeId, day: first.day, after: secondCode },
      { employeeId, day: second.day, after: firstCode }
    ];
  }
  return null;
}

export function proposeMonthNeighbor(plan, source, random) {
  const type = Math.floor(random() * 3);
  const primary = type === 0
    ? singleCellChange(plan, source, random)
    : type === 1
      ? sameDaySwap(plan, source, random)
      : sameEmployeeSwap(plan, source, random);
  return primary
    ?? sameDaySwap(plan, source, random)
    ?? sameEmployeeSwap(plan, source, random)
    ?? singleCellChange(plan, source, random);
}
