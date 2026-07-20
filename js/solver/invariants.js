function asMap(value, key = "id") {
  if (value instanceof Map) return value;
  if (Array.isArray(value)) return new Map(value.map((item) => [item?.[key], item]));
  return new Map(Object.entries(value && typeof value === "object" ? value : {}));
}

function failure(code, message, detail = {}) {
  return { code, message, ...detail };
}

function cellKey(employeeId, day) {
  return `${employeeId}:${day}`;
}

function lockedCells(plan) {
  return plan?.lockedCells instanceof Set ? plan.lockedCells : new Set(plan?.lockedCells ?? []);
}

function validShape(plan) {
  return Boolean(
    plan
    && typeof plan.periodStart === "string"
    && Number.isInteger(plan.dayCount)
    && plan.dayCount >= 0
    && Array.isArray(plan.employeeOrder)
    && Array.isArray(plan.assignments)
    && plan.assignments.length === plan.employeeOrder.length
    && plan.assignments.every((row) => Array.isArray(row) && row.length === plan.dayCount)
    && new Set(plan.employeeOrder).size === plan.employeeOrder.length
  );
}

function shiftUsable(shift) {
  return Boolean(shift && shift.disabled !== true && shift.enabled !== false && shift.usable !== false);
}

function baseFailures(plan, baseline, context, { allowRepairNulls = null } = {}) {
  const failures = [];
  if (!validShape(plan)) {
    failures.push(failure("malformedPlan", "盤面の配列寸法または従業員順が不正です。"));
    return failures;
  }
  const employees = asMap(context?.employees);
  const shiftTypes = asMap(context?.shiftTypes, "code");
  const repairSet = allowRepairNulls instanceof Set ? allowRepairNulls : null;
  for (let employeeIndex = 0; employeeIndex < plan.employeeOrder.length; employeeIndex += 1) {
    const employeeId = plan.employeeOrder[employeeIndex];
    if (!employees.has(employeeId)) {
      failures.push(failure("unknownEmployee", `従業員${employeeId}が評価コンテキストに存在しません。`, { employeeId }));
    }
    for (let day = 0; day < plan.dayCount; day += 1) {
      const code = plan.assignments[employeeIndex][day];
      const key = cellKey(employeeId, day);
      if (code === null) {
        if (!repairSet?.has(key)) failures.push(failure("unassignedCell", `${employeeId}の${day}日目が未割当です。`, { employeeId, day }));
        continue;
      }
      const shift = shiftTypes.get(code);
      if (!shift) {
        failures.push(failure("unknownShift", `シフト${code}が評価コンテキストに存在しません。`, { employeeId, day }));
      } else if (!shiftUsable(shift)) {
        failures.push(failure("unusableShift", `シフト${code}は使用できません。`, { employeeId, day }));
      } else {
        const allowedCodes = employees.get(employeeId)?.allowedShiftCodes;
        if (Array.isArray(allowedCodes) && allowedCodes.length > 0 && !shift.isDayOff && !allowedCodes.includes(code)) {
          failures.push(failure("unusableShift", `${employeeId}はシフト${code}を使用できません。`, { employeeId, day }));
        }
      }
    }
  }
  if (baseline && (
    plan.periodStart !== baseline.periodStart
    || plan.dayCount !== baseline.dayCount
    || JSON.stringify(plan.employeeOrder) !== JSON.stringify(baseline.employeeOrder)
  )) {
    failures.push(failure("periodMismatch", "期間または従業員順が基準盤面と一致しません。"));
  }
  return failures;
}

export function checkCompletePlanInvariants(plan, baseline, context) {
  const failures = baseFailures(plan, baseline, context);
  if (!validShape(baseline)) failures.push(failure("malformedPlan", "基準盤面の配列寸法または従業員順が不正です。"));
  if (!validShape(plan) || !validShape(baseline)) return { ok: failures.length === 0, failures };
  const locks = new Set([...lockedCells(baseline), ...lockedCells(plan)]);
  for (let employeeIndex = 0; employeeIndex < plan.employeeOrder.length; employeeIndex += 1) {
    const employeeId = plan.employeeOrder[employeeIndex];
    for (let day = 0; day < plan.dayCount; day += 1) {
      if (!locks.has(cellKey(employeeId, day))) continue;
      if (plan.assignments[employeeIndex][day] !== baseline.assignments[employeeIndex][day]) {
        failures.push(failure("lockedCellChanged", `${employeeId}の${day}日目のロックセルが変更されています。`, { employeeId, day }));
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

export function checkRepairStateInvariants(state, repairCells, baseline, context) {
  const plan = state?.plan ?? state;
  const repairSet = repairCells instanceof Set ? repairCells : new Set(repairCells ?? []);
  const failures = baseFailures(plan, baseline, context, { allowRepairNulls: repairSet });
  if (!validShape(baseline)) failures.push(failure("malformedPlan", "基準盤面の配列寸法または従業員順が不正です。"));
  if (!validShape(plan) || !validShape(baseline)) return { ok: failures.length === 0, failures };
  const locks = new Set([...lockedCells(baseline), ...lockedCells(plan)]);
  for (const key of repairSet) {
    if (locks.has(key)) failures.push(failure("lockedRepairCell", `修復対象${key}はロックされています。`));
  }
  for (let employeeIndex = 0; employeeIndex < plan.employeeOrder.length; employeeIndex += 1) {
    const employeeId = plan.employeeOrder[employeeIndex];
    for (let day = 0; day < plan.dayCount; day += 1) {
      const key = cellKey(employeeId, day);
      if (repairSet.has(key)) continue;
      if (plan.assignments[employeeIndex][day] !== baseline.assignments[employeeIndex][day]) {
        failures.push(failure("unexpectedChange", `${employeeId}の${day}日目は修復対象外ですが変更されています。`, { employeeId, day }));
      }
    }
  }
  return { ok: failures.length === 0, failures };
}
