// 連携用出力へ記録するツール内検証の範囲を、安定した識別子で定義する。
// 会社固有の検査を追加する場合は既存プロファイルの意味を変えず、別プロファイルまたは新版を追加する。
export const VALIDATION_PROFILE = "shift-assistant-standard";
export const VALIDATION_PROFILE_VERSION = 1;

export const VALIDATION_CHECKS_PERFORMED = Object.freeze([
  "assignment_completeness",
  "shift_code_reference",
  "requested_day_off_consistency",
  "break_and_lock_consistency",
  "configured_break_rules",
  "minimum_rest_interval_11h",
  "configured_consecutive_work_limit",
  "configured_coverage_requirements",
  "configured_fixed_overtime_limit",
  "adjacent_month_boundaries_when_available",
  "integration_master_codes"
]);

export const VALIDATION_ITEMS_NOT_CHECKED = Object.freeze([
  "source_master_accuracy",
  "all_company_work_rules",
  "individual_contracts_and_restrictions",
  "target_system_schema_and_mapping",
  "human_approval_and_registration_result"
]);

function nonNegativeCount(value) {
  return Math.max(0, Number(value) || 0);
}

export function buildValidationRecord(readiness, { checkedAt = new Date().toISOString() } = {}) {
  if (!readiness?.ready || nonNegativeCount(readiness.blankCount) > 0 || nonNegativeCount(readiness.blockingCount) > 0) {
    throw new Error("ツール内検証を通過していない月の検証記録は作成できません。");
  }
  return {
    profile: VALIDATION_PROFILE,
    profileVersion: VALIDATION_PROFILE_VERSION,
    toolChecksPassed: true,
    checkedAt,
    counts: {
      blank: nonNegativeCount(readiness.blankCount),
      error: nonNegativeCount(readiness.blockingCount),
      warning: nonNegativeCount(readiness.warningCount),
      info: nonNegativeCount(readiness.infoCount)
    },
    checksPerformed: [...VALIDATION_CHECKS_PERFORMED],
    notChecked: [...VALIDATION_ITEMS_NOT_CHECKED],
    humanReview: {
      requiredBeforeRegistration: true,
      approvalRecordedByTool: false
    }
  };
}
