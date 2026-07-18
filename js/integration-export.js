// 社内システム連携用の機械可読エクスポートを構築する純粋モジュール。
// フィールド名・値の形式はdocs/integration.mdで契約として明文化している。
// 契約を変更する場合はINTEGRATION_EXPORT_VERSIONを上げ、docs/integration.mdを更新する。
import { buildMonthDays, isValidTime } from "./date-time.js";
import { buildShiftTypeMap, getShiftCodeFromData } from "./month-overview.js";
import { normalizeEmploymentType } from "./employment-types.js";
import { compareEmployeeOrder } from "./workspace-normalizer.js";
import { normalizeEmployeeCode } from "./master-codes.js";
import { validateBreaks } from "./break-rules.js";
import {
  nonNegativeMinutes,
  breakMinutesWithinShift,
  paidMinutesForShift,
  overtimeMinutesForShift
} from "./shift-metrics.js";

export const INTEGRATION_EXPORT_FORMAT = "shift-assistant-integration";
export const INTEGRATION_EXPORT_VERSION = 2;

export const INTEGRATION_CSV_HEADER = [
  "format_version",
  "document_status",
  "validation_profile",
  "validation_profile_version",
  "date",
  "employee_code",
  "shift_code",
  "is_work",
  "start",
  "end",
  "break_minutes",
  "work_minutes",
  "overtime_minutes",
  "breaks"
];

function trimmedCode(value) {
  return String(value ?? "").trim();
}

// 連携キー（従業員コード・シフトコード）の欠落と重複を検査する。
export function validateIntegrationMaster(workspace) {
  const errors = [];

  const employeeCodes = new Map();
  for (const employee of workspace.employees ?? []) {
    const code = trimmedCode(employee.code);
    if (!code) {
      errors.push(`従業員「${employee.name}」に従業員コードがありません。`);
      continue;
    }
    // 連携キーは半角・大文字へ正規化済みであること。旧データに全角・小文字が
    // 残っている場合は、従業員編集で保存し直すかマスター再取込で自動修正できる。
    if (code !== normalizeEmployeeCode(code)) {
      errors.push(`従業員コード「${code}」（${employee.name}）に全角文字または小文字が含まれています。従業員情報を保存し直してください。`);
      continue;
    }
    if (employeeCodes.has(code)) {
      errors.push(`従業員コード「${code}」が「${employeeCodes.get(code)}」と「${employee.name}」で重複しています。`);
      continue;
    }
    employeeCodes.set(code, employee.name);
  }

  const shiftCodes = new Set();
  for (const shiftType of workspace.shiftTypes ?? []) {
    const code = trimmedCode(shiftType.code);
    if (!code) {
      errors.push(`シフト区分「${shiftType.name}」にシフトコードがありません。`);
      continue;
    }
    if (shiftCodes.has(code)) errors.push(`シフトコード「${code}」が重複しています。`);
    shiftCodes.add(code);
  }

  return errors;
}

function validBreaks(breaks) {
  return (breaks ?? [])
    .filter((item) => isValidTime(item?.start) && isValidTime(item?.end))
    .map((item) => ({ start: item.start, end: item.end }));
}

export function buildIntegrationExport(workspace, { generatedAt = new Date().toISOString(), validation = null } = {}) {
  const errors = validateIntegrationMaster(workspace);
  const monthValue = workspace.selectedMonth ?? workspace.targetMonth;
  if (!monthValue) errors.push("対象月がありません。");
  if (errors.length) return { ok: false, errors };

  const employees = [...(workspace.employees ?? [])].sort(compareEmployeeOrder);
  const shiftTypesByCode = buildShiftTypeMap(workspace.shiftTypes ?? []);
  const assignments = [];

  for (const dayInfo of buildMonthDays(monthValue)) {
    for (const employee of employees) {
      const shiftCode = getShiftCodeFromData(workspace.shifts, monthValue, employee.id, dayInfo.day);
      if (!shiftCode) continue;
      const shiftType = shiftTypesByCode.get(shiftCode);
      if (!shiftType) {
        errors.push(`${dayInfo.dateValue} ${employee.name}: シフトコード「${shiftCode}」がシフト区分に登録されていません。`);
        continue;
      }
      const breaks = shiftType.isWork ? validBreaks(workspace.breaks?.[dayInfo.dateValue]?.[employee.id]) : [];
      // 勤務シフトはツールに実装した休憩ルール（勤務枠内・重複なし・必要時間充足）を
      // 満たしていない限り出力しない。不完全な実働時間を下流へ流さないための防壁。
      if (shiftType.isWork) {
        const breakValidation = validateBreaks(shiftType, breaks);
        if (!breakValidation.ok) {
          errors.push(`${dayInfo.dateValue} ${employee.name}: 休憩が不正です（${breakValidation.issues.join("、")}）。`);
          continue;
        }
      }
      const breakMinutes = breakMinutesWithinShift(shiftType, breaks);
      assignments.push({
        date: dayInfo.dateValue,
        employeeCode: trimmedCode(employee.code),
        shiftCode: trimmedCode(shiftType.code),
        isWork: Boolean(shiftType.isWork),
        start: shiftType.start ?? "",
        end: shiftType.end ?? "",
        breaks,
        breakMinutes,
        workMinutes: paidMinutesForShift(shiftType, { breakMinutes }),
        overtimeMinutes: overtimeMinutesForShift(shiftType)
      });
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      format: INTEGRATION_EXPORT_FORMAT,
      formatVersion: INTEGRATION_EXPORT_VERSION,
      documentStatus: "candidate",
      generatedAt,
      workspaceName: workspace.name ?? "",
      month: monthValue,
      ...(validation ? { validation } : {}),
      employees: employees.map((employee) => ({
        employeeCode: trimmedCode(employee.code),
        name: employee.name,
        department: employee.department ?? "",
        employmentType: normalizeEmploymentType(employee.employmentType),
        fixedOvertimeMinutes: nonNegativeMinutes(employee.fixedOvertimeMinutes)
      })),
      shiftTypes: (workspace.shiftTypes ?? []).map((shiftType) => ({
        shiftCode: trimmedCode(shiftType.code),
        name: shiftType.name,
        isWork: Boolean(shiftType.isWork),
        start: shiftType.start ?? "",
        end: shiftType.end ?? "",
        paidMinutes: Number.isFinite(Number(shiftType.paidMinutes)) ? Math.max(0, Number(shiftType.paidMinutes)) : null,
        overtimeMinutes: overtimeMinutesForShift(shiftType)
      })),
      assignments
    }
  };
}

// 機械連携用CSVはRFC 4180の引用符ルールに従い、値の書き換え（数式ガードなど）は行わない。
function csvField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function integrationAssignmentsToCsv(data) {
  const rows = [INTEGRATION_CSV_HEADER];
  for (const assignment of data.assignments) {
    rows.push([
      data.formatVersion,
      data.documentStatus,
      data.validation?.profile ?? "",
      data.validation?.profileVersion ?? "",
      assignment.date,
      assignment.employeeCode,
      assignment.shiftCode,
      assignment.isWork ? 1 : 0,
      assignment.start,
      assignment.end,
      assignment.breakMinutes,
      assignment.workMinutes,
      assignment.overtimeMinutes,
      assignment.breaks.map((item) => `${item.start}-${item.end}`).join("/")
    ]);
  }
  return `${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}
