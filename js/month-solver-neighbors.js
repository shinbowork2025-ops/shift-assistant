function currentCode(plan, employeeId, day) {
  return plan.assignments?.[employeeId]?.[day] ?? "";
}

function pick(items, random) {
  if (!items.length) return null;
  return items[Math.floor(random() * items.length)];
}

export function createMonthSolverNeighborSource(plan) {
  const mutableCells = [...plan.mutableCells];
  const byDay = new Map();
  const byEmployee = new Map();
  for (const cell of mutableCells) {
    if (!byDay.has(cell.day)) byDay.set(cell.day, []);
    byDay.get(cell.day).push(cell);
    if (!byEmployee.has(cell.employeeId)) byEmployee.set(cell.employeeId, []);
    byEmployee.get(cell.employeeId).push(cell);
  }
  return {
    mutableCells,
    byDay,
    byEmployee,
    pairDays: [...byDay.entries()].filter(([, cells]) => cells.length >= 2).map(([day]) => day),
    pairEmployees: [...byEmployee.entries()].filter(([, cells]) => cells.length >= 2).map(([id]) => id)
  };
}

function singleChange(plan, source, random) {
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
    const day = pick(source.pairDays, random);
    if (!day) return null;
    const cells = source.byDay.get(day) ?? [];
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
    const employeeId = pick(source.pairEmployees, random);
    if (!employeeId) return null;
    const cells = source.byEmployee.get(employeeId) ?? [];
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

export function proposeMonthSolverNeighbor(plan, source, random) {
  const mode = Math.floor(random() * 3);
  const first = mode === 0
    ? singleChange(plan, source, random)
    : mode === 1
      ? sameDaySwap(plan, source, random)
      : sameEmployeeSwap(plan, source, random);
  return first
    ?? sameDaySwap(plan, source, random)
    ?? sameEmployeeSwap(plan, source, random)
    ?? singleChange(plan, source, random);
}
