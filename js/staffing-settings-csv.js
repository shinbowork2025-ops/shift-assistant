import { parseCsv } from "./csv.js";
import { normalizeCoverageRequirements } from "./coverage-requirements.js";

const HEADER = [
  "種別", "従業員コード", "氏名", "保有資格", "曜日", "開始", "終了", "合計",
  "社員", "準社員", "パート・アルバイト", "必要部門", "部門人数", "必要資格", "資格者人数"
];

function normalize(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_\-（）()・]/g, "");
}

function column(headers, aliases) {
  const normalized = aliases.map(normalize);
  return headers.findIndex((value) => normalized.includes(normalize(value)));
}

function valueAt(row, index) {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function numberAt(row, index) {
  const number = Number(valueAt(row, index));
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function splitQualifications(value) {
  return [...new Set(String(value ?? "").split(/[、,;\n]/).map((item) => item.trim()).filter(Boolean))];
}

function scopeFromText(value) {
  const text = normalize(value);
  if (["平日", "weekday"].includes(text)) return "weekday";
  if (["土日", "週末", "weekend"].includes(text)) return "weekend";
  return "everyday";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function parseStaffingSettingsRows(rows, employees = []) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("見出し行とデータ行が必要です。");
  const headers = rows[0];
  const columns = {
    type: column(headers, ["種別", "type"]),
    employeeCode: column(headers, ["従業員コード", "社員コード", "employeeCode"]),
    employeeName: column(headers, ["氏名", "従業員名", "name"]),
    qualifications: column(headers, ["保有資格", "資格", "qualifications"]),
    scope: column(headers, ["曜日", "適用曜日", "scope"]),
    start: column(headers, ["開始", "開始時刻", "start"]),
    end: column(headers, ["終了", "終了時刻", "end"]),
    total: column(headers, ["合計", "合計人数", "requiredTotal"]),
    fulltime: column(headers, ["社員", "正社員", "fulltime"]),
    semi: column(headers, ["準社員", "semi"]),
    parttime: column(headers, ["パートアルバイト", "パート・アルバイト", "parttime"]),
    department: column(headers, ["必要部門", "部門", "requiredDepartment"]),
    departmentCount: column(headers, ["部門人数", "必要部門人数", "requiredDepartmentCount"]),
    qualification: column(headers, ["必要資格", "requiredQualification"]),
    qualificationCount: column(headers, ["資格者人数", "必要資格者人数", "requiredQualificationCount"])
  };
  if (columns.type < 0) throw new Error("「種別」列が見つかりません。");

  const requirements = [];
  const qualificationUpdates = [];
  const errors = [];
  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const type = normalize(valueAt(row, columns.type));
    if (["従業員資格", "資格", "employee", "employeequalification"].includes(type)) {
      const code = valueAt(row, columns.employeeCode);
      const name = valueAt(row, columns.employeeName);
      const employee = code
        ? employees.find((item) => item.code === code)
        : employees.find((item) => item.name === name);
      if (!employee) {
        errors.push(`${line}行目: 対象従業員が見つかりません。`);
        return;
      }
      qualificationUpdates.push({ employeeId: employee.id, qualifications: splitQualifications(valueAt(row, columns.qualifications)) });
      return;
    }
    if (["必要人数", "配置条件", "requirement", "staffing"].includes(type)) {
      requirements.push({
        scope: scopeFromText(valueAt(row, columns.scope)),
        start: valueAt(row, columns.start),
        end: valueAt(row, columns.end),
        requiredTotal: numberAt(row, columns.total),
        requiredByType: {
          fulltime: numberAt(row, columns.fulltime),
          semi: numberAt(row, columns.semi),
          parttime: numberAt(row, columns.parttime)
        },
        requiredDepartment: valueAt(row, columns.department),
        requiredDepartmentCount: numberAt(row, columns.departmentCount),
        requiredQualification: valueAt(row, columns.qualification),
        requiredQualificationCount: numberAt(row, columns.qualificationCount)
      });
      return;
    }
    errors.push(`${line}行目: 種別は「従業員資格」または「必要人数」にしてください。`);
  });

  return { requirements: normalizeCoverageRequirements(requirements), qualificationUpdates, errors };
}

export function parseStaffingSettingsCsv(text, employees = []) {
  return parseStaffingSettingsRows(parseCsv(text), employees);
}

export function buildStaffingSettingsCsv({ employees = [], requirements = [] } = {}) {
  const rows = [HEADER];
  for (const employee of employees) {
    rows.push([
      "従業員資格", employee.code, employee.name, (employee.qualifications ?? []).join(";"),
      "", "", "", "", "", "", "", "", "", "", ""
    ]);
  }
  for (const requirement of normalizeCoverageRequirements(requirements)) {
    const scopeLabel = requirement.scope === "weekday" ? "平日" : requirement.scope === "weekend" ? "土日" : "毎日";
    rows.push([
      "必要人数", "", "", "", scopeLabel, requirement.start, requirement.end,
      requirement.requiredTotal, requirement.requiredByType.fulltime, requirement.requiredByType.semi,
      requirement.requiredByType.parttime, requirement.requiredDepartment, requirement.requiredDepartmentCount,
      requirement.requiredQualification, requirement.requiredQualificationCount
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export const SAMPLE_STAFFING_SETTINGS_CSV = `\uFEFF${HEADER.join(",")}\r\n従業員資格,E001,田中太郎,危険物取扱者;農薬アドバイザー,,,,,,,,,,,\r\n必要人数,,,,平日,09:00,17:00,4,1,0,0,園芸,1,農薬アドバイザー,1`;
