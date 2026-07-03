export const PUBLIC_HOLIDAY_CODE = "休";

const PUBLIC_HOLIDAY_NAME = "公休";
const PUBLIC_HOLIDAY_ALIASES = new Set(["休", "7", "off", "OFF"]);
const LEGACY_GENERIC_SHIFTS = new Map([
  ["early", "早番"],
  ["middle", "中番"],
  ["late", "遅番"],
  ["short", "短時間"]
]);

function text(value) {
  return String(value ?? "").trim();
}

export function isPublicHolidayDefinition(shiftType) {
  return Boolean(shiftType)
    && !shiftType.isWork
    && text(shiftType.name) === PUBLIC_HOLIDAY_NAME
    && PUBLIC_HOLIDAY_ALIASES.has(text(shiftType.code));
}

export function canonicalShiftCode(code, name = "", isWork = false) {
  const normalizedCode = text(code);
  return !isWork && text(name) === PUBLIC_HOLIDAY_NAME && PUBLIC_HOLIDAY_ALIASES.has(normalizedCode)
    ? PUBLIC_HOLIDAY_CODE
    : normalizedCode;
}

function isLegacyGenericDefinition(shiftType) {
  const expectedName = LEGACY_GENERIC_SHIFTS.get(text(shiftType?.code));
  return Boolean(expectedName) && text(shiftType?.name) === expectedName;
}

function canonicalPublicHoliday(shiftType) {
  return {
    ...shiftType,
    code: PUBLIC_HOLIDAY_CODE,
    name: PUBLIC_HOLIDAY_NAME,
    shortLabel: PUBLIC_HOLIDAY_CODE,
    start: "",
    end: "",
    isWork: false,
    paidMinutes: 0,
    overtimeMinutes: 0
  };
}

function removeEmptyContainers(shifts, monthValue, employeeId) {
  const employeeShifts = shifts[monthValue]?.[employeeId];
  if (employeeShifts && Object.keys(employeeShifts).length === 0) delete shifts[monthValue][employeeId];
  if (shifts[monthValue] && Object.keys(shifts[monthValue]).length === 0) delete shifts[monthValue];
}

function removeBreak(breaks, dateValue, employeeId) {
  if (!breaks[dateValue]) return;
  delete breaks[dateValue][employeeId];
  if (Object.keys(breaks[dateValue]).length === 0) delete breaks[dateValue];
}

function removeLock(shiftLocks, monthValue, employeeId, dateValue) {
  const employeeLocks = shiftLocks[monthValue]?.[employeeId];
  if (!employeeLocks) return;
  delete employeeLocks[dateValue];
  if (Object.keys(employeeLocks).length === 0) delete shiftLocks[monthValue][employeeId];
  if (shiftLocks[monthValue] && Object.keys(shiftLocks[monthValue]).length === 0) delete shiftLocks[monthValue];
}

function migrateAssignments(shifts, breaks, shiftLocks, legacyCodes, publicHolidayAliases) {
  let removedAssignments = 0;
  let convertedPublicHolidays = 0;

  for (const [monthValue, monthShifts] of Object.entries(shifts)) {
    if (!monthShifts || typeof monthShifts !== "object") continue;
    for (const [employeeId, employeeShifts] of Object.entries(monthShifts)) {
      if (!employeeShifts || typeof employeeShifts !== "object") continue;
      for (const [dateValue, codeValue] of Object.entries(employeeShifts)) {
        const code = text(codeValue);
        if (legacyCodes.has(code)) {
          delete employeeShifts[dateValue];
          removeBreak(breaks, dateValue, employeeId);
          removeLock(shiftLocks, monthValue, employeeId, dateValue);
          removedAssignments += 1;
        } else if (publicHolidayAliases.has(code) && code !== PUBLIC_HOLIDAY_CODE) {
          employeeShifts[dateValue] = PUBLIC_HOLIDAY_CODE;
          convertedPublicHolidays += 1;
        }
      }
      removeEmptyContainers(shifts, monthValue, employeeId);
    }
  }
  return { removedAssignments, convertedPublicHolidays };
}

function migrateEmployeePreferences(employees, legacyCodes, publicHolidayAliases) {
  let changed = 0;
  for (const employee of employees) {
    const beforeAllowed = Array.isArray(employee.allowedShiftCodes) ? employee.allowedShiftCodes : [];
    const filteredAllowed = beforeAllowed.filter((code) => {
      const normalized = text(code);
      return !legacyCodes.has(normalized) && !publicHolidayAliases.has(normalized);
    });
    if (filteredAllowed.length !== beforeAllowed.length) {
      employee.allowedShiftCodes = filteredAllowed;
      changed += 1;
    }
    const preferred = text(employee.preferredShiftCode);
    if (legacyCodes.has(preferred) || publicHolidayAliases.has(preferred)) {
      employee.preferredShiftCode = "";
      changed += 1;
    }
  }
  return changed;
}

export function migrateShiftCatalog({ shiftTypes, shifts, breaks, shiftLocks, employees, defaultShiftTypes }) {
  const legacyCodes = new Set(shiftTypes.filter(isLegacyGenericDefinition).map((shiftType) => shiftType.code));
  const publicHolidayAliases = new Set(
    shiftTypes.filter(isPublicHolidayDefinition).map((shiftType) => text(shiftType.code))
  );

  const byCode = new Map();
  let catalogChanged = false;
  for (const shiftType of shiftTypes) {
    if (legacyCodes.has(shiftType.code)) {
      catalogChanged = true;
      continue;
    }
    const normalized = isPublicHolidayDefinition(shiftType) ? canonicalPublicHoliday(shiftType) : shiftType;
    if (normalized.code !== shiftType.code) catalogChanged = true;
    if (!byCode.has(normalized.code)) byCode.set(normalized.code, normalized);
    else catalogChanged = true;
  }

  let migratedShiftTypes;
  if (legacyCodes.size > 0) {
    const defaultCodes = new Set(defaultShiftTypes.map((shiftType) => shiftType.code));
    migratedShiftTypes = defaultShiftTypes.map((shiftType) => byCode.get(shiftType.code) ?? structuredClone(shiftType));
    migratedShiftTypes.push(...[...byCode.values()].filter((shiftType) => !defaultCodes.has(shiftType.code)));
    catalogChanged = true;
  } else {
    migratedShiftTypes = [...byCode.values()];
  }

  const assignmentResult = migrateAssignments(
    shifts,
    breaks,
    shiftLocks,
    legacyCodes,
    publicHolidayAliases
  );
  const preferenceChanges = migrateEmployeePreferences(employees, legacyCodes, publicHolidayAliases);
  const migrated = catalogChanged
    || assignmentResult.removedAssignments > 0
    || assignmentResult.convertedPublicHolidays > 0
    || preferenceChanges > 0;

  return {
    shiftTypes: migratedShiftTypes,
    shifts,
    breaks,
    shiftLocks,
    employees,
    migrated,
    removedAssignments: assignmentResult.removedAssignments,
    convertedPublicHolidays: assignmentResult.convertedPublicHolidays
  };
}
