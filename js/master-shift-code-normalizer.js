import { canonicalShiftCode, PUBLIC_HOLIDAY_CODE } from "./shift-catalog-migration.js";

const HEADER_ALIASES = Object.freeze({
  type: ["種別", "type", "区分"],
  code: ["コード", "従業員コード", "シフトコード", "code", "id"],
  commonName: ["名称", "name"],
  shiftName: ["シフト名", "勤務名", "shift", "shiftName"],
  start: ["開始時刻", "開始", "start", "startTime"],
  end: ["終了時刻", "終了", "end", "endTime"],
  shortLabel: ["略称", "短縮名", "shortLabel"]
});

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

function looksLikeShiftRow(row, columns) {
  const type = normalizeHeader(valueAt(row, columns.type));
  if (type.includes("シフト") || type.includes("shift") || type.includes("勤務")) return true;
  return columns.type < 0 && (columns.shiftName >= 0 || columns.start >= 0 || columns.end >= 0);
}

export function canonicalizeMasterShiftRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const result = rows.map((row) => Array.isArray(row) ? [...row] : []);
  const headers = result[0];
  const columns = {
    type: findColumn(headers, HEADER_ALIASES.type),
    code: findColumn(headers, HEADER_ALIASES.code),
    commonName: findColumn(headers, HEADER_ALIASES.commonName),
    shiftName: findColumn(headers, HEADER_ALIASES.shiftName),
    start: findColumn(headers, HEADER_ALIASES.start),
    end: findColumn(headers, HEADER_ALIASES.end),
    shortLabel: findColumn(headers, HEADER_ALIASES.shortLabel)
  };
  const nameColumn = columns.shiftName >= 0 ? columns.shiftName : columns.commonName;
  if (columns.code < 0 || nameColumn < 0) return result;

  for (const row of result.slice(1)) {
    if (!looksLikeShiftRow(row, columns)) continue;
    const name = valueAt(row, nameColumn);
    const start = valueAt(row, columns.start);
    const end = valueAt(row, columns.end);
    const code = canonicalShiftCode(valueAt(row, columns.code), name, Boolean(start || end));
    if (code !== PUBLIC_HOLIDAY_CODE) continue;
    row[columns.code] = PUBLIC_HOLIDAY_CODE;
    row[nameColumn] = "公休";
    if (columns.shortLabel >= 0) row[columns.shortLabel] = PUBLIC_HOLIDAY_CODE;
  }
  return result;
}
