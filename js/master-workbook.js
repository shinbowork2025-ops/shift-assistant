const HEADER_ALIASES = Object.freeze({
  type: ["種別", "type", "区分"],
  code: ["コード", "従業員コード", "シフトコード", "code", "id"],
  commonName: ["名称", "name"],
  shiftName: ["シフト名", "勤務名", "shift", "shiftName"],
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

function isPrimaryMasterSheet(worksheet) {
  if (!Array.isArray(worksheet?.rows) || worksheet.rows.length < 2) return false;
  const headers = worksheet.rows[0];
  const hasType = findColumn(headers, HEADER_ALIASES.type) >= 0;
  const hasCode = findColumn(headers, HEADER_ALIASES.code) >= 0;
  const hasName = findColumn(headers, HEADER_ALIASES.commonName) >= 0
    || findColumn(headers, HEADER_ALIASES.shiftName) >= 0;
  return hasType && hasCode && hasName;
}

function isSupplementSheet(worksheet) {
  const normalizedName = normalizeHeader(worksheet?.sheetName);
  return normalizedName.includes("休日区分") || normalizedName.includes("特殊シフト");
}

function createSupplementShiftRow(headers, code, name) {
  const row = Array.from({ length: headers.length }, () => "");
  const typeColumn = findColumn(headers, HEADER_ALIASES.type);
  const codeColumn = findColumn(headers, HEADER_ALIASES.code);
  const nameColumn = findColumn(headers, HEADER_ALIASES.shiftName) >= 0
    ? findColumn(headers, HEADER_ALIASES.shiftName)
    : findColumn(headers, HEADER_ALIASES.commonName);
  const shortLabelColumn = findColumn(headers, HEADER_ALIASES.shortLabel);

  row[typeColumn] = "シフト";
  row[codeColumn] = code;
  row[nameColumn] = name;
  if (shortLabelColumn >= 0) row[shortLabelColumn] = code.slice(0, 4);
  return row;
}

function fillMissingShiftNames(rows) {
  const headers = rows[0] ?? [];
  const typeColumn = findColumn(headers, HEADER_ALIASES.type);
  const codeColumn = findColumn(headers, HEADER_ALIASES.code);
  const nameColumn = findColumn(headers, HEADER_ALIASES.shiftName) >= 0
    ? findColumn(headers, HEADER_ALIASES.shiftName)
    : findColumn(headers, HEADER_ALIASES.commonName);
  const shortLabelColumn = findColumn(headers, HEADER_ALIASES.shortLabel);
  let filledShiftNames = 0;

  for (const row of rows.slice(1)) {
    const type = normalizeHeader(valueAt(row, typeColumn));
    if (!type.includes("シフト") && !type.includes("shift") && !type.includes("勤務")) continue;
    const code = valueAt(row, codeColumn);
    if (!code || valueAt(row, nameColumn)) continue;
    row[nameColumn] = code;
    if (shortLabelColumn >= 0 && !valueAt(row, shortLabelColumn)) row[shortLabelColumn] = code.slice(0, 4);
    filledShiftNames += 1;
  }
  return filledShiftNames;
}

function existingShiftCodes(rows) {
  const headers = rows[0] ?? [];
  const typeColumn = findColumn(headers, HEADER_ALIASES.type);
  const codeColumn = findColumn(headers, HEADER_ALIASES.code);
  const codes = new Set();

  for (const row of rows.slice(1)) {
    const type = normalizeHeader(valueAt(row, typeColumn));
    if (!type.includes("シフト") && !type.includes("shift") && !type.includes("勤務")) continue;
    const code = valueAt(row, codeColumn);
    if (code) codes.add(code);
  }
  return codes;
}

export function prepareMasterWorkbookRows(worksheets) {
  if (!Array.isArray(worksheets) || worksheets.length === 0) {
    throw new Error("Excelファイルにワークシートがありません。");
  }

  const primary = worksheets.find(isPrimaryMasterSheet);
  if (!primary) {
    throw new Error("Excelに「種別・コード・名称」を含むマスターデータ用シートが見つかりません。");
  }

  const rows = primary.rows.map((row) => [...row]);
  const headers = rows[0];
  const filledShiftNames = fillMissingShiftNames(rows);
  const shiftCodes = existingShiftCodes(rows);
  const usedSheetNames = [primary.sheetName];
  const ignoredSupplementRows = [];
  let supplementalShiftCount = 0;

  for (const worksheet of worksheets) {
    if (worksheet === primary || !isSupplementSheet(worksheet) || worksheet.rows.length < 2) continue;
    const supplementalHeaders = worksheet.rows[0];
    const codeColumn = findColumn(supplementalHeaders, HEADER_ALIASES.code);
    const nameColumn = findColumn(supplementalHeaders, HEADER_ALIASES.commonName);
    if (codeColumn < 0 || nameColumn < 0) continue;

    usedSheetNames.push(worksheet.sheetName);
    for (const row of worksheet.rows.slice(1)) {
      const code = valueAt(row, codeColumn);
      const name = valueAt(row, nameColumn);
      if (!code && !name) continue;
      if (!code || !name || code.includes("シフト")) {
        ignoredSupplementRows.push({ sheetName: worksheet.sheetName, code, name });
        continue;
      }
      if (shiftCodes.has(code)) continue;

      rows.push(createSupplementShiftRow(headers, code, name));
      shiftCodes.add(code);
      supplementalShiftCount += 1;
    }
  }

  return {
    rows,
    primarySheetName: primary.sheetName,
    usedSheetNames,
    supplementalShiftCount,
    filledShiftNames,
    ignoredSupplementRows
  };
}
