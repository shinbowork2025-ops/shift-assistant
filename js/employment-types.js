// 雇用区分の定義と正規化。
// 区分ごとに必要な人数が異なるため、1日チャートで区分別の実配置人数を表示する。
export const EMPLOYMENT_TYPES = Object.freeze([
  Object.freeze({ code: "fulltime", label: "社員", shortLabel: "社" }),
  Object.freeze({ code: "semi", label: "準社員", shortLabel: "準" }),
  Object.freeze({ code: "parttime", label: "パート・アルバイト", shortLabel: "パ" })
]);

export const DEFAULT_EMPLOYMENT_TYPE = "parttime";

const typesByCode = new Map(EMPLOYMENT_TYPES.map((type) => [type.code, type]));

// 表記ゆれを含む文字列から雇用区分コードを判定する。判定できない場合はnull。
// 「準社員」が「社員」を含むため、判定順に意味がある。
export function matchEmploymentType(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (typesByCode.has(text)) return text;
  if (text.includes("準")) return "semi";
  if (text.includes("パート") || text.includes("アルバイト") || text.includes("バイト")) return "parttime";
  if (text.includes("社員")) return "fulltime";
  return null;
}

export function normalizeEmploymentType(value) {
  return matchEmploymentType(value) ?? DEFAULT_EMPLOYMENT_TYPE;
}

export function employmentTypeLabel(code) {
  return typesByCode.get(code)?.label ?? typesByCode.get(DEFAULT_EMPLOYMENT_TYPE).label;
}

export function employmentTypeShortLabel(code) {
  return typesByCode.get(code)?.shortLabel ?? typesByCode.get(DEFAULT_EMPLOYMENT_TYPE).shortLabel;
}
