import { state, createId, isValidTime, timeToMinutes, scheduleSave } from "./model.js";
import { DEFAULT_EMPLOYMENT_TYPE, matchEmploymentType } from "./employment-types.js";
import { compareEmployeeOrder } from "./workspace-normalizer.js";
import { normalizeEmployeeCode } from "./master-codes.js";
import { normalizeShiftBreakPolicy } from "./solver/shift-adapter.js";

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

function duplicateCodes(rows, columns, hasEmployeeHeader, hasShiftHeader) {
  const employeeLines = new Map();
  const shiftLines = new Map();

  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const type = inferRowType(valueAt(row, columns.type), hasEmployeeHeader, hasShiftHeader);
    if (type === "employee") {
      const code = normalizeEmployeeCode(valueAt(row, columns.code));
      if (code) employeeLines.set(code, [...(employeeLines.get(code) ?? []), line]);
    } else if (type === "shift") {
      const rawCode = valueAt(row, columns.code);
      const name = valueAt(row, columns.shiftName) || valueAt(row, columns.commonName) || rawCode;
      const code = rawCode || (name ? `shift-${name}` : "");
      if (code) shiftLines.set(code, [...(shiftLines.get(code) ?? []), line]);
    }
  });

  return {
    employees: new Map([...employeeLines].filter(([, lines]) => lines.length > 1)),
    shifts: new Map([...shiftLines].filter(([, lines]) => lines.length > 1))
  };
}

function duplicateMessage(kind, code, line, lines) {
  const otherLines = lines.filter((candidate) => candidate !== line).join("・");
  return `${line}行目: ${kind}「${code}」がファイル内の${otherLines}行目と重複しています。`;
}

function importValueEquals(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function employeeOperation(record, context) {
  const { summary, operations, duplicateEmployeeCodes } = context;
  const rowErrors = [];
  if (!record.name) {
    rowErrors.push(`${record.line}行目: 従業員名がありません。`);
  }

  const code = normalizeEmployeeCode(record.code);
  if (!code) {
    rowErrors.push(`${record.line}行目: 従業員コードがありません。社員番号など重複しない値を入力してください。`);
  } else if (duplicateEmployeeCodes.has(code)) {
    rowErrors.push(duplicateMessage("従業員コード", code, record.line, duplicateEmployeeCodes.get(code)));
  }

  let employmentType = null;
  if (record.employmentTypeText) {
    employmentType = matchEmploymentType(record.employmentTypeText);
    if (!employmentType) {
      rowErrors.push(`${record.line}行目: 雇用区分は社員、準社員、パート・アルバイトのいずれかで入力してください。`);
    }
  }
  if (rowErrors.length) {
    summary.errors.push(...rowErrors);
    return;
  }

  // 従業員コードは社内システム連携の照合キーのため必須。照合はコードだけで行う。
  // 全角・小文字の揺れを吸収するため、半角・大文字へ正規化して保存する。
  const existing = state.employees.find((employee) => normalizeEmployeeCode(employee.code) === code);

  if (existing) {
    const changes = {
      name: record.name,
      code,
      department: record.department,
      order: record.order || existing.order,
      ...(employmentType ? { employmentType } : {}),
      ...(record.fixedOvertimeMinutes !== null ? { fixedOvertimeMinutes: record.fixedOvertimeMinutes } : {})
    };
    const changed = Object.entries(changes).some(([key, value]) => existing[key] !== value);
    operations.push({ entity: "employee", action: changed ? "update" : "unchanged", existingId: existing.id, changes, line: record.line });
    if (changed) summary.updatedEmployees += 1;
    else summary.unchangedEmployees += 1;
    return;
  }

  operations.push({
    entity: "employee",
    action: "add",
    value: {
      name: record.name,
      code,
      department: record.department,
      order: record.order || state.employees.length + summary.addedEmployees + 1,
      employmentType: employmentType ?? DEFAULT_EMPLOYMENT_TYPE,
      fixedOvertimeMinutes: record.fixedOvertimeMinutes ?? 0
    },
    line: record.line
  });
  summary.addedEmployees += 1;
}

function shiftOperation(record, context) {
  const { summary, operations, duplicateShiftCodes } = context;
  const rowErrors = [];
  const name = record.name || record.code;
  if (!name) {
    rowErrors.push(`${record.line}行目: シフト名またはシフトコードがありません。`);
  }
  const hasTimes = Boolean(record.start || record.end);
  if (hasTimes && (!isValidTime(record.start) || !isValidTime(record.end))) {
    rowErrors.push(`${record.line}行目: 開始時刻または終了時刻がHH:MM形式ではありません。`);
  }
  // 日をまたぐシフトは時間計算（実働・休憩・勤務間隔）が扱えないため登録を拒否する。
  if (hasTimes && isValidTime(record.start) && isValidTime(record.end) && timeToMinutes(record.end) <= timeToMinutes(record.start)) {
    rowErrors.push(`${record.line}行目: 終了時刻は開始時刻より後にしてください（日をまたぐシフトは登録できません）。`);
  }

  const code = record.code || `shift-${name}`;
  if (duplicateShiftCodes.has(code)) {
    rowErrors.push(duplicateMessage("シフトコード", code, record.line, duplicateShiftCodes.get(code)));
  }
  const existing = state.shiftTypes.find((shift) => shift.code === code)
    ?? (!record.code ? state.shiftTypes.find((shift) => shift.name === name) : null);

  let paidMinutes = existing?.paidMinutes;
  if (record.paidMinutes !== "") {
    const parsed = Number(record.paidMinutes);
    if (Number.isFinite(parsed) && parsed >= 0) {
      paidMinutes = Math.round(parsed);
    } else {
      rowErrors.push(`${record.line}行目: 実働分は0以上の数値で入力してください。`);
    }
  }
  if (rowErrors.length) {
    summary.errors.push(...rowErrors);
    return;
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
  Object.assign(shiftValue, normalizeShiftBreakPolicy(shiftValue, existing?.breakPolicy));
  if (!shiftValue.breakPolicyValid) {
    summary.breakPolicyErrors.push({
      line: record.line,
      code: shiftValue.code,
      name: shiftValue.name,
      issues: [...shiftValue.breakPolicyIssues]
    });
  }

  if (existing) {
    const changed = Object.entries(shiftValue).some(([key, value]) => !importValueEquals(existing[key], value));
    operations.push({ entity: "shift", action: changed ? "update" : "unchanged", existingCode: existing.code, changes: shiftValue, line: record.line });
    if (changed) summary.updatedShifts += 1;
    else summary.unchangedShifts += 1;
  } else {
    operations.push({ entity: "shift", action: "add", value: shiftValue, line: record.line });
    summary.addedShifts += 1;
  }
}

// 全行を検証し、stateを変更せずに適用計画を返す。
export function prepareMasterImport(rows) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("見出し行とデータ行が必要です。");

  const headers = rows[0];
  const columns = {
    type: findColumn(headers, ["種別", "type", "区分"]),
    code: findColumn(headers, ["コード", "従業員コード", "シフトコード", "code", "id"]),
    commonName: findColumn(headers, ["名称", "name"]),
    employeeName: findColumn(headers, ["氏名", "従業員名", "スタッフ名", "employee", "employeeName"]),
    shiftName: findColumn(headers, ["シフト名", "勤務名", "shift", "shiftName"]),
    department: findColumn(headers, ["所属", "部門", "department"]),
    employmentType: findColumn(headers, ["雇用区分", "雇用形態", "employmentType"]),
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

  const hasEmployeeHeader = columns.employeeName >= 0 || columns.employmentType >= 0
    || columns.fixedOvertimeHours >= 0 || columns.fixedOvertimeMinutes >= 0;
  const hasShiftHeader = columns.shiftName >= 0 || columns.start >= 0 || columns.end >= 0 || columns.overtimeHours >= 0 || columns.overtimeMinutes >= 0;
  if (columns.type < 0 && !hasEmployeeHeader && !hasShiftHeader) {
    throw new Error("従業員名、シフト名、開始時刻などの対応する見出しが見つかりません。");
  }

  const summary = {
    addedEmployees: 0,
    updatedEmployees: 0,
    unchangedEmployees: 0,
    addedShifts: 0,
    updatedShifts: 0,
    unchangedShifts: 0,
    breakPolicyErrors: [],
    errors: []
  };
  const operations = [];
  const duplicates = duplicateCodes(rows, columns, hasEmployeeHeader, hasShiftHeader);
  const context = {
    summary,
    operations,
    duplicateEmployeeCodes: duplicates.employees,
    duplicateShiftCodes: duplicates.shifts
  };

  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const type = inferRowType(valueAt(row, columns.type), hasEmployeeHeader, hasShiftHeader);
    const commonName = valueAt(row, columns.commonName);
    if (type === "employee") {
      const errorCountBefore = summary.errors.length;
      const fixedOvertimeMinutes = durationToMinutes(
        valueAt(row, columns.fixedOvertimeHours),
        valueAt(row, columns.fixedOvertimeMinutes),
        "固定残業時間",
        line,
        summary.errors
      );
      if (summary.errors.length > errorCountBefore) return;
      employeeOperation({
        line,
        code: valueAt(row, columns.code),
        name: valueAt(row, columns.employeeName) || commonName,
        department: valueAt(row, columns.department),
        employmentTypeText: valueAt(row, columns.employmentType),
        order: Number(valueAt(row, columns.order)) || 0,
        fixedOvertimeMinutes
      }, context);
    } else if (type === "shift") {
      const errorCountBefore = summary.errors.length;
      const overtimeMinutes = durationToMinutes(
        valueAt(row, columns.overtimeHours),
        valueAt(row, columns.overtimeMinutes),
        "シフトの残業時間",
        line,
        summary.errors
      );
      if (summary.errors.length > errorCountBefore) return;
      shiftOperation({
        line,
        code: valueAt(row, columns.code),
        name: valueAt(row, columns.shiftName) || commonName,
        start: valueAt(row, columns.start),
        end: valueAt(row, columns.end),
        shortLabel: valueAt(row, columns.shortLabel),
        paidMinutes: valueAt(row, columns.paidMinutes),
        overtimeMinutes
      }, context);
    } else {
      summary.errors.push(`${line}行目: 種別を判定できません。`);
    }
  });

  summary.errorRows = new Set(summary.errors.map((message) => message.match(/^(\d+)行目:/)?.[1]).filter(Boolean)).size;
  return { operations, errors: summary.errors, summary };
}

// 検証済み計画を1回で適用する。エラーを含む計画は明示的なallowPartialが必要。
export function applyMasterImport(plan, { save = true, allowPartial = false } = {}) {
  if (!plan || !Array.isArray(plan.operations) || !Array.isArray(plan.errors)) {
    throw new Error("マスター取込計画が不正です。");
  }
  if (plan.errors.length && !allowPartial) {
    return { ...plan.summary, errors: [...plan.errors], applied: false, partial: false };
  }

  // 更新対象がプレビュー後も存在することを、1件も変更する前に確認する。
  for (const operation of plan.operations) {
    if (operation.action !== "update") continue;
    if (operation.entity === "employee" && !state.employees.some((employee) => employee.id === operation.existingId)) {
      throw new Error(`${operation.line}行目の更新対象従業員が見つかりません。再度ファイルを読み込んでください。`);
    }
    if (operation.entity === "shift" && !state.shiftTypes.some((shift) => shift.code === operation.existingCode)) {
      throw new Error(`${operation.line}行目の更新対象シフトが見つかりません。再度ファイルを読み込んでください。`);
    }
  }

  for (const operation of plan.operations) {
    if (operation.action === "unchanged") continue;
    if (operation.entity === "employee" && operation.action === "add") {
      state.employees.push({ id: createId("employee"), ...operation.value });
    } else if (operation.entity === "employee") {
      const existing = state.employees.find((employee) => employee.id === operation.existingId);
      Object.assign(existing, operation.changes);
    } else if (operation.entity === "shift" && operation.action === "add") {
      state.shiftTypes.push({ ...operation.value });
    } else if (operation.entity === "shift") {
      const existing = state.shiftTypes.find((shift) => shift.code === operation.existingCode);
      Object.assign(existing, operation.changes);
    }
  }

  state.employees.sort(compareEmployeeOrder);
  if (save) scheduleSave();
  return {
    ...plan.summary,
    errors: [...plan.errors],
    applied: true,
    partial: plan.errors.length > 0
  };
}

// options.save: falseにするとIndexedDB保存を予約しない（Nodeテスト用）。
// エラー行がある場合、allowPartial: trueを明示しない限りstateを変更しない。
export function importMasterRows(rows, { save = true, allowPartial = false } = {}) {
  return applyMasterImport(prepareMasterImport(rows), { save, allowPartial });
}

export function importMasterCsvText(text) {
  return importMasterRows(parseCsv(text));
}

export function formatImportSummary(summary, sourceLabel = "") {
  const parts = [
    sourceLabel,
    `従業員 追加${summary.addedEmployees}名・更新${summary.updatedEmployees}名・変更なし${summary.unchangedEmployees ?? 0}名`,
    `シフト 追加${summary.addedShifts}件・更新${summary.updatedShifts}件・変更なし${summary.unchangedShifts ?? 0}件`
  ].filter(Boolean);
  if (summary.filledShiftNames) {
    parts.push(`名称空欄${summary.filledShiftNames}件はコードを使用`);
  }
  if (summary.ignoredSupplementRows?.length) {
    parts.push(`複合入力の説明${summary.ignoredSupplementRows.length}行は取込対象外`);
  }
  if (summary.repairedBreakDates) {
    parts.push(`シフト時刻変更に伴い休憩を${summary.repairedBreakDates}日分再配置`);
  }
  if (summary.breakPolicyErrors?.length) {
    parts.push(`休憩設定エラー${summary.breakPolicyErrors.length}件（ソルバー起動不可）`);
  }
  if (summary.errors.length) parts.push(`読込不可${summary.errorRows ?? summary.errors.length}行${summary.partial ? "（正常行のみ反映）" : ""}`);
  return parts.join(" / ");
}

export const SAMPLE_MASTER_CSV = `種別,コード,名称,開始時刻,終了時刻,所属,表示順,略称,固定残業時間,シフト残業時間\r\n従業員,E001,田中太郎,,,園芸,1,,20,\r\n従業員,E002,佐藤花子,,,資材,2,,10,\r\nシフト,01,01,06:45,16:15,,,01,,0\r\nシフト,02,02,06:45,17:45,,,02,,0\r\nシフト,07,07,08:45,20:15,,,07,,0\r\nシフト,休,公休,,,,,休,,0\r\nシフト,Y,有給休暇,,,,,Y,,0\r\n`;
