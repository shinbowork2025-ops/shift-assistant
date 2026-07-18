import test from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRATION_EXPORT_FORMAT,
  INTEGRATION_EXPORT_VERSION,
  INTEGRATION_CSV_HEADER,
  validateIntegrationMaster,
  buildIntegrationExport,
  integrationAssignmentsToCsv
} from "../js/integration-export.js";
import {
  VALIDATION_PROFILE,
  VALIDATION_PROFILE_VERSION,
  buildValidationRecord
} from "../js/validation-profile.js";

function sampleValidation(checkedAt = "2026-07-18T00:00:00.000Z") {
  return buildValidationRecord({
    ready: true,
    blankCount: 0,
    blockingCount: 0,
    warningCount: 0,
    infoCount: 2
  }, { checkedAt });
}

function sampleWorkspace() {
  return {
    name: "園芸売場",
    selectedMonth: "2026-07",
    employees: [
      { id: "e2", code: "E002", name: "佐藤花子", department: "資材", employmentType: "parttime", fixedOvertimeMinutes: 0, order: 2 },
      { id: "e1", code: "E001", name: "田中太郎", department: "園芸", employmentType: "fulltime", fixedOvertimeMinutes: 1200, order: 1 }
    ],
    shiftTypes: [
      { code: "01", name: "早番", shortLabel: "01", start: "06:45", end: "16:15", isWork: true, overtimeMinutes: 0 },
      { code: "休", name: "公休", shortLabel: "休", start: "", end: "", isWork: false, overtimeMinutes: 0 }
    ],
    shifts: {
      "2026-07": {
        e1: { "2026-07-01": "01", "2026-07-02": "休" },
        e2: { "2026-07-01": "01" }
      }
    },
    breaks: {
      "2026-07-01": {
        e1: [{ type: "lunch", label: "昼休憩", start: "12:00", end: "13:00" }],
        e2: [{ type: "lunch", label: "昼休憩", start: "11:00", end: "12:00" }]
      }
    }
  };
}

test("正常なワークスペースから連携用データを構築する", () => {
  const result = buildIntegrationExport(sampleWorkspace(), { generatedAt: "2026-07-18T00:00:00.000Z" });
  assert.equal(result.ok, true);

  const { data } = result;
  assert.equal(data.format, INTEGRATION_EXPORT_FORMAT);
  assert.equal(data.formatVersion, INTEGRATION_EXPORT_VERSION);
  assert.equal(data.documentStatus, "candidate");
  assert.equal(data.month, "2026-07");
  assert.equal(data.workspaceName, "園芸売場");

  // 従業員は表示順で並び、雇用区分は内部コードで出力する
  assert.deepEqual(data.employees.map((employee) => employee.employeeCode), ["E001", "E002"]);
  assert.equal(data.employees[0].employmentType, "fulltime");
  assert.equal(data.employees[0].fixedOvertimeMinutes, 1200);

  assert.equal(data.shiftTypes.length, 2);
  assert.equal(data.shiftTypes[0].shiftCode, "01");
  assert.equal(data.shiftTypes[0].paidMinutes, null);

  // 割当は日付順・従業員順。空欄セルは含めない
  assert.equal(data.assignments.length, 3);
  const [first, second, third] = data.assignments;
  assert.deepEqual(
    { date: first.date, employeeCode: first.employeeCode, shiftCode: first.shiftCode },
    { date: "2026-07-01", employeeCode: "E001", shiftCode: "01" }
  );
  assert.equal(first.breakMinutes, 60);
  assert.equal(first.workMinutes, 9 * 60 + 30 - 60);
  assert.deepEqual(first.breaks, [{ start: "12:00", end: "13:00" }]);

  assert.deepEqual(
    { date: second.date, employeeCode: second.employeeCode },
    { date: "2026-07-01", employeeCode: "E002" }
  );

  // 休日区分は isWork: false・実働0分
  assert.equal(third.shiftCode, "休");
  assert.equal(third.isWork, false);
  assert.equal(third.workMinutes, 0);
});

test("従業員コードの欠落・重複を検出して出力を拒否する", () => {
  const missing = sampleWorkspace();
  missing.employees[0].code = "";
  const missingResult = buildIntegrationExport(missing);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.errors.some((message) => message.includes("従業員コードがありません")));

  const duplicated = sampleWorkspace();
  duplicated.employees[0].code = "E001";
  const duplicatedResult = buildIntegrationExport(duplicated);
  assert.equal(duplicatedResult.ok, false);
  assert.ok(duplicatedResult.errors.some((message) => message.includes("重複")));
});

test("未正規化の従業員コード（全角・小文字）は出力を拒否する", () => {
  const fullWidth = sampleWorkspace();
  fullWidth.employees[1].code = "Ｅ００１";
  const fullWidthResult = buildIntegrationExport(fullWidth);
  assert.equal(fullWidthResult.ok, false);
  assert.ok(fullWidthResult.errors.some((message) => message.includes("全角文字または小文字")));

  const lowerCase = sampleWorkspace();
  lowerCase.employees[1].code = "e001";
  const lowerCaseResult = buildIntegrationExport(lowerCase);
  assert.equal(lowerCaseResult.ok, false);
});

test("休憩ルールを満たさない勤務シフトは出力を拒否する", () => {
  // 休憩なし（9.5時間拘束で必要60分が不足）
  const noBreaks = sampleWorkspace();
  delete noBreaks.breaks["2026-07-01"].e2;
  const noBreaksResult = buildIntegrationExport(noBreaks);
  assert.equal(noBreaksResult.ok, false);
  assert.ok(noBreaksResult.errors.some((message) => message.includes("休憩が不正")));

  // 勤務枠の外に配置された休憩
  const outside = sampleWorkspace();
  outside.breaks["2026-07-01"].e2 = [{ type: "lunch", label: "昼休憩", start: "17:00", end: "18:00" }];
  const outsideResult = buildIntegrationExport(outside);
  assert.equal(outsideResult.ok, false);
});

test("検証サマリーを渡すとJSONへvalidationとして埋め込む", () => {
  const validation = sampleValidation();
  const result = buildIntegrationExport(sampleWorkspace(), { validation });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.validation, validation);
  assert.equal(result.data.validation.profile, VALIDATION_PROFILE);
  assert.equal(result.data.validation.profileVersion, VALIDATION_PROFILE_VERSION);
  assert.equal(result.data.validation.toolChecksPassed, true);
  assert.equal(result.data.validation.humanReview.approvalRecordedByTool, false);
  assert.ok(result.data.validation.notChecked.includes("human_approval_and_registration_result"));

  const withoutValidation = buildIntegrationExport(sampleWorkspace());
  assert.equal("validation" in withoutValidation.data, false);
});

test("シフト区分に存在しないコードの割当はエラーにする", () => {
  const workspace = sampleWorkspace();
  workspace.shifts["2026-07"].e1["2026-07-03"] = "99";
  const result = buildIntegrationExport(workspace);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("「99」")));
});

test("validateIntegrationMasterはシフトコードの重複も検出する", () => {
  const workspace = sampleWorkspace();
  workspace.shiftTypes.push({ code: "01", name: "重複", isWork: true, start: "09:00", end: "17:00" });
  const errors = validateIntegrationMaster(workspace);
  assert.ok(errors.some((message) => message.includes("シフトコード「01」")));
});

test("連携用CSVは縦持ちでRFC 4180に従う", () => {
  const { data } = buildIntegrationExport(sampleWorkspace(), {
    generatedAt: "2026-07-18T00:00:00.000Z",
    validation: sampleValidation()
  });
  const csv = integrationAssignmentsToCsv(data);
  const lines = csv.split("\r\n");

  assert.equal(lines[0], INTEGRATION_CSV_HEADER.join(","));
  assert.equal(lines[1], "2,candidate,shift-assistant-standard,1,2026-07-01,E001,01,1,06:45,16:15,60,510,0,12:00-13:00");
  assert.equal(lines[3], "2,candidate,shift-assistant-standard,1,2026-07-02,E001,休,0,,,0,0,0,");
  assert.equal(lines.at(-1), "");
  // BOMを付けない（機械連携用のため）
  assert.notEqual(csv.charCodeAt(0), 0xfeff);
});
