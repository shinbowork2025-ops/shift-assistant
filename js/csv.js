import { state, createId, isValidTime, scheduleSave } from "./model.js";
import { compareEmployeeOrder } from "./workspace-normalizer.js";

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value ?? "").trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some((value) => String(value ?? "").trim() !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-（）()]/g, "");
}

function findColumn(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.findIndex((header) => normalizedAliases.includes(normalizeHeader(header)));
}

function valueAt(row, index) {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function inferRowType(typeValue, hasEmployeeHeader, hasShiftHeader) {
  const normalized = normalizeHeader(typeValue);
  if (normalized.includes("従業員") || normalized.includes("employee") || normalized.includes("staff")) return "employee";
  if (normalized.includes("シフト") || normalized.includes("shift") || normalized.includes("勤務")) return "shift";
  if (hasShiftHeader && !hasEmployeeHeader) return "shift";
  if (hasEmployeeHeader && !hasShiftHeader) return "employee";
  return "";
}

function durationToMinutes(hoursValue, minutesValue, label, line, errors) {
  const minutesText = String(minutesValue ?? "").trim();
  const hoursText = String(hoursValue ?? "").trim();
  if (!minutesText && !hoursText) return null;

  if (minutesText) {
    const minutes = Number(minutesText);
    if (Number.isFinite(minutes) && minutes >= 0) return Math.round(minutes);
    errors.push(`${line}行目: ${label}（分）が数値ではありません。`);
    return null;
  }

  const clockMatch = hoursText.match(/^(\d+):([0-5]\d)$/);
  if (clockMatch) return Number(clockMatch[1]) * 60 + Number(clockMatch[2]);

  const hours = Number(hoursText);
  if (Number.isFinite(hours) && hours >= 0) return Math.round(hours * 60);
  errors.push(`${line}行目: ${label}は20、1.5、01:30などの形式で入力してください。`);
  return null;
}

function importEmployee(record, summary) {
  if (!record.name) {
    summary.errors.push(`${record.line}行目: 従業員名がありません。`);
    return;
  }

  const existing = record.code
    ? state.employees.find((employee) => employee.code === record.code)
    : state.employees.find((employee) => employee.name === record.name);

  if (existing) {
    existing.name = record.name;
    existing.code = record.code || existing.code;
    existing.department = record.department;
    existing.order = record.order || existing.order;
    if (record.fixedOvertimeMinutes !== null) existing.fixedOvertimeMinutes = record.fixedOvertimeMinutes;
    summary.updatedEmployees += 1;
    return;
  }

  state.employees.push({
    id: createId("employee"),
    name: record.name,
    code: record.code,
    department: record.department,
    order: record.order || state.employees.length + 1,
    fixedOvertimeMinutes: record.fixedOvertimeMinutes ?? 0
  });
  summary.addedEmployees += 1;
}

function importShift(record, summary) {
  const name = record.name || record.code;
  if (!name) {
    summary.errors.push(`${record.line}行目: シフト名またはシフトコードがありません。`);
    return;
  }
  const hasTimes = Boolean(record.start || record.end);
  if (hasTimes && (!isValidTime(record.start) || !isValidTime(record.end))) {
    summary.errors.push(`${record.line}行目: 開始時刻または終了時刻がHH:MM形式ではありません。`);
    return;
  }

  const code = record.code || `shift-${name}`;
  const existing = state.shiftTypes.find((shift) => shift.code === code)
    ?? (!record.code ? state.shiftTypes.find((shift) => shift.name === name) : null);

  let paidMinutes = existing?.paidMinutes;
  if (record.paidMinutes !== "") {
    const parsed = Number(record.paidMinutes);
    if (Number.isFinite(parsed) && parsed >= 0) {
      paidMinutes = Math.round(parsed);
    } else {
      summary.errors.push(`${record.line}行目: 実働分は0以上の数値で入力してください。`);
    }
  }

  const shiftValue = {
    code: existing?.code ?? code,
    name,
    shortLabel: record.shortLabel || record.code.slice(0, 4) || name.slice(0, 2),
    start: hasTimes ? record.start : "",
    end: hasTimes ? record.end : "",
    isWork: hasTimes,
    paidMinutes,
    overtimeMinutes: record.overtimeMinutes ?? existing?.overtimeMinutes ?? 0
  };

  if (existing) {
    Object.assign(existing, shiftValue);
    summary.updatedShifts += 1;
  } else {
    state.shiftTypes.push(shiftValue);
    summary.addedShifts += 1;
  }
}

export function importMasterRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("見出し行とデータ行が必要です。");

  const headers = rows[0];
  const columns = {
    type: findColumn(headers, ["種別", "type", "区分"]),
    code: findColumn(headers, ["コード", "従業員コード", "シフトコード", "code", "id"]),
    commonName: findColumn(headers, ["名称", "name"]),
    employeeName: findColumn(headers, ["氏名", "従業員名", "スタッフ名", "employee", "employeeName"]),
    shiftName: findColumn(headers, ["シフト名", "勤務名", "shift", "shiftName"]),
    department: findColumn(headers, ["所属", "部門", "department"]),
    order: findColumn(headers, ["表示順", "順番", "order"]),
    start: findColumn(headers, ["開始時刻", "開始", "start", "startTime"]),
    end: findColumn(headers, ["終了時刻", "終了", "end", "endTime"]),
    shortLabel: findColumn(headers, ["略称", "短縮名", "shortLabel"]),
    paidMinutes: findColumn(headers, ["実働分", "勤務分", "paidMinutes"]),
    fixedOvertimeHours: findColumn(headers, ["固定残業時間", "みなし残業時間", "fixedOvertimeHours"]),
    fixedOvertimeMinutes: findColumn(headers, ["固定残業分", "固定残業時間分", "fixedOvertimeMinutes"]),
    overtimeHours: findColumn(headers, ["残業時間", "シフト残業時間", "overtimeHours"]),
    overtimeMinutes: findColumn(headers, ["残業分", "シフト残業分", "overtimeMinutes"])
  };

  const hasEmployeeHeader = columns.employeeName >= 0 || columns.fixedOvertimeHours >= 0 || columns.fixedOvertimeMinutes >= 0;
  const hasShiftHeader = columns.shiftName >= 0 || columns.start >= 0 || columns.end >= 0 || columns.overtimeHours >= 0 || columns.overtimeMinutes >= 0;
  if (columns.type < 0 && !hasEmployeeHeader && !hasShiftHeader) {
    throw new Error("従業員名、シフト名、開始時刻などの対応する見出しが見つかりません。");
  }

  const summary = {
    addedEmployees: 0,
    updatedEmployees: 0,
    addedShifts: 0,
    updatedShifts: 0,
    errors: []
  };

  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const type = inferRowType(valueAt(row, columns.type), hasEmployeeHeader, hasShiftHeader);
    const commonName = valueAt(row, columns.commonName);
    if (type === "employee") {
      const fixedOvertimeMinutes = durationToMinutes(
        valueAt(row, columns.fixedOvertimeHours),
        valueAt(row, columns.fixedOvertimeMinutes),
        "固定残業時間",
        line,
        summary.errors
      );
      importEmployee({
        line,
        code: valueAt(row, columns.code),
        name: valueAt(row, columns.employeeName) || commonName,
        department: valueAt(row, columns.department),
        order: Number(valueAt(row, columns.order)) || 0,
        fixedOvertimeMinutes
      }, summary);
    } else if (type === "shift") {
      const overtimeMinutes = durationToMinutes(
        valueAt(row, columns.overtimeHours),
        valueAt(row, columns.overtimeMinutes),
        "シフトの残業時間",
        line,
        summary.errors
      );
      importShift({
        line,
        code: valueAt(row, columns.code),
        name: valueAt(row, columns.shiftName) || commonName,
        start: valueAt(row, columns.start),
        end: valueAt(row, columns.end),
        shortLabel: valueAt(row, columns.shortLabel),
        paidMinutes: valueAt(row, columns.paidMinutes),
        overtimeMinutes
      }, summary);
    } else {
      summary.errors.push(`${line}行目: 種別を判定できません。`);
    }
  });

  state.employees.sort(compareEmployeeOrder);
  scheduleSave();
  return summary;
}

export function importMasterCsvText(text) {
  return importMasterRows(parseCsv(text));
}

export function formatImportSummary(summary, sourceLabel = "") {
  const parts = [
    sourceLabel,
    `従業員 追加${summary.addedEmployees}名・更新${summary.updatedEmployees}名`,
    `シフト 追加${summary.addedShifts}件・更新${summary.updatedShifts}件`
  ].filter(Boolean);
  if (summary.filledShiftNames) {
    parts.push(`名称空欄${summary.filledShiftNames}件はコードを使用`);
  }
  if (summary.ignoredSupplementRows?.length) {
    parts.push(`複合入力の説明${summary.ignoredSupplementRows.length}行は取込対象外`);
  }
  if (summary.errors.length) parts.push(`読込不可${summary.errors.length}行`);
  return parts.join(" / ");
}

export const SAMPLE_MASTER_CSV = `種別,コード,名称,開始時刻,終了時刻,所属,表示順,略称,固定残業時間,シフト残業時間\r\n従業員,E001,田中太郎,,,園芸,1,,20,\r\n従業員,E002,佐藤花子,,,資材,2,,10,\r\nシフト,S01,早番,09:00,18:00,,,早,,1\r\nシフト,S02,遅番,12:00,21:00,,,遅,,0.5\r\nシフト,OFF,公休,,,,,休,,0\r\n`;
