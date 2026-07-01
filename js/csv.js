import { state, createId, isValidTime, scheduleSave } from "./model.js";

function parseCsv(text) {
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
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
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
    summary.updatedEmployees += 1;
    return;
  }

  state.employees.push({
    id: createId("employee"),
    name: record.name,
    code: record.code,
    department: record.department,
    order: record.order || state.employees.length + 1
  });
  summary.addedEmployees += 1;
}

function importShift(record, summary) {
  if (!record.name) {
    summary.errors.push(`${record.line}行目: シフト名がありません。`);
    return;
  }
  const hasTimes = Boolean(record.start || record.end);
  if (hasTimes && (!isValidTime(record.start) || !isValidTime(record.end))) {
    summary.errors.push(`${record.line}行目: 開始時刻または終了時刻がHH:MM形式ではありません。`);
    return;
  }

  const code = record.code || `shift-${record.name}`;
  const existing = state.shiftTypes.find((shift) => shift.code === code)
    ?? (!record.code ? state.shiftTypes.find((shift) => shift.name === record.name) : null);
  const shiftValue = {
    code: existing?.code ?? code,
    name: record.name,
    shortLabel: record.shortLabel || record.name.slice(0, 2),
    start: hasTimes ? record.start : "",
    end: hasTimes ? record.end : "",
    isWork: hasTimes,
    paidMinutes: record.paidMinutes === "" ? existing?.paidMinutes : Math.max(0, Number(record.paidMinutes))
  };

  if (existing) {
    Object.assign(existing, shiftValue);
    summary.updatedShifts += 1;
  } else {
    state.shiftTypes.push(shiftValue);
    summary.addedShifts += 1;
  }
}

export function importMasterCsvText(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSVに見出し行とデータ行が必要です。");

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
    paidMinutes: findColumn(headers, ["実働分", "勤務分", "paidMinutes"])
  };

  const hasEmployeeHeader = columns.employeeName >= 0;
  const hasShiftHeader = columns.shiftName >= 0 || columns.start >= 0 || columns.end >= 0;
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
    const type = inferRowType(valueAt(row, columns.type), hasEmployeeHeader, hasShiftHeader);
    const commonName = valueAt(row, columns.commonName);
    if (type === "employee") {
      importEmployee({
        line: index + 2,
        code: valueAt(row, columns.code),
        name: valueAt(row, columns.employeeName) || commonName,
        department: valueAt(row, columns.department),
        order: Number(valueAt(row, columns.order)) || 0
      }, summary);
    } else if (type === "shift") {
      importShift({
        line: index + 2,
        code: valueAt(row, columns.code),
        name: valueAt(row, columns.shiftName) || commonName,
        start: valueAt(row, columns.start),
        end: valueAt(row, columns.end),
        shortLabel: valueAt(row, columns.shortLabel),
        paidMinutes: valueAt(row, columns.paidMinutes)
      }, summary);
    } else {
      summary.errors.push(`${index + 2}行目: 種別を判定できません。`);
    }
  });

  state.employees.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"));
  scheduleSave();
  return summary;
}

export function formatImportSummary(summary) {
  const parts = [
    `従業員 追加${summary.addedEmployees}名・更新${summary.updatedEmployees}名`,
    `シフト 追加${summary.addedShifts}件・更新${summary.updatedShifts}件`
  ];
  if (summary.errors.length) parts.push(`読込不可${summary.errors.length}行`);
  return parts.join(" / ");
}

export const SAMPLE_MASTER_CSV = `種別,コード,名称,開始時刻,終了時刻,所属,表示順,略称\r\n従業員,E001,田中太郎,,,園芸,1,\r\n従業員,E002,佐藤花子,,,資材,2,\r\nシフト,S01,早番,09:00,18:00,,,早\r\nシフト,S02,遅番,12:00,21:00,,,遅\r\nシフト,OFF,公休,,,,,休\r\n`;
