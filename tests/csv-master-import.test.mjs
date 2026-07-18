import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/model.js";
import { prepareMasterImport, importMasterRows } from "../js/csv.js";

// scheduleSave()を呼ぶとIndexedDBアクセスの非同期タイマーが走るため、
// { save: false }を指定してモデルの状態更新だけを検証する。

const HEADER = ["種別", "コード", "名称", "開始時刻", "終了時刻", "所属", "表示順", "略称", "固定残業時間", "シフト残業時間"];

function resetEmployees() {
  state.employees.length = 0;
}

test("従業員コードのない従業員行はエラーとして取り込まない", () => {
  resetEmployees();
  const summary = importMasterRows([
    HEADER,
    ["従業員", "", "田中太郎", "", "", "園芸", "1", "", "", ""]
  ], { save: false });

  assert.equal(summary.addedEmployees, 0);
  assert.equal(state.employees.length, 0);
  assert.ok(summary.errors.some((message) => message.includes("従業員コードがありません")));
});

test("従業員コードは半角・大文字へ正規化し、正規化後の値で照合する", () => {
  resetEmployees();
  importMasterRows([
    HEADER,
    ["従業員", "ｅ００１", "田中太郎", "", "", "園芸", "1", "", "", ""]
  ], { save: false });

  assert.equal(state.employees[0].code, "E001");

  // 小文字・全角の表記違いは同一従業員の更新として扱う
  const summary = importMasterRows([
    HEADER,
    ["従業員", "e001", "田中太郎", "", "", "資材", "1", "", "", ""]
  ], { save: false });

  assert.equal(summary.updatedEmployees, 1);
  assert.equal(state.employees.length, 1);
  assert.equal(state.employees[0].code, "E001");
  assert.equal(state.employees[0].department, "資材");

  resetEmployees();
});

test("日をまたぐシフト行はエラーとして取り込まない", () => {
  const summary = importMasterRows([
    HEADER,
    ["シフト", "N1", "夜勤", "22:00", "06:00", "", "", "", "", ""],
    ["シフト", "Z1", "ゼロ", "09:00", "09:00", "", "", "", "", ""]
  ], { save: false });

  assert.equal(summary.addedShifts, 0);
  assert.equal(summary.errors.length, 2);
  assert.ok(summary.errors.every((message) => message.includes("日をまたぐシフトは登録できません")));
});

test("従業員はコードだけで照合し、同名でもコードが違えば別人として追加する", () => {
  resetEmployees();
  importMasterRows([
    HEADER,
    ["従業員", "E001", "田中太郎", "", "", "園芸", "1", "", "", ""]
  ], { save: false });

  const summary = importMasterRows([
    HEADER,
    ["従業員", "E001", "田中太郎", "", "", "資材", "1", "", "", ""],
    ["従業員", "E002", "田中太郎", "", "", "園芸", "2", "", "", ""]
  ], { save: false });

  assert.equal(summary.updatedEmployees, 1);
  assert.equal(summary.addedEmployees, 1);
  assert.equal(state.employees.length, 2);
  assert.equal(state.employees.find((employee) => employee.code === "E001").department, "資材");

  resetEmployees();
});

test("取込前検証では状態を変更せず、エラーがあれば既定で全件を中止する", () => {
  resetEmployees();
  const rows = [
    HEADER,
    ["従業員", "E001", "田中太郎", "", "", "園芸", "1", "", "", ""],
    ["従業員", "", "佐藤花子", "", "", "資材", "2", "", "", ""]
  ];

  const plan = prepareMasterImport(rows);
  assert.equal(state.employees.length, 0);
  assert.equal(plan.summary.addedEmployees, 1);
  assert.equal(plan.errors.length, 1);

  const summary = importMasterRows(rows, { save: false });
  assert.equal(summary.applied, false);
  assert.equal(state.employees.length, 0);
});

test("エラー確認後に明示した場合だけ正常行を部分適用する", () => {
  resetEmployees();
  const summary = importMasterRows([
    HEADER,
    ["従業員", "E001", "田中太郎", "", "", "園芸", "1", "", "", ""],
    ["従業員", "", "佐藤花子", "", "", "資材", "2", "", "", ""]
  ], { save: false, allowPartial: true });

  assert.equal(summary.applied, true);
  assert.equal(summary.partial, true);
  assert.equal(state.employees.length, 1);
  assert.equal(state.employees[0].code, "E001");
  resetEmployees();
});

test("ファイル内でIDが重複した場合は該当する全行を拒否する", () => {
  resetEmployees();
  importMasterRows([
    HEADER,
    ["従業員", "E001", "田中太郎", "", "", "園芸", "1", "", "", ""]
  ], { save: false });

  const plan = prepareMasterImport([
    HEADER,
    ["従業員", "E001", "田中太郎", "", "", "園芸", "1", "", "", ""],
    ["従業員", "E001", "別名", "", "", "資材", "2", "", "", ""]
  ]);
  assert.equal(plan.summary.unchangedEmployees, 0);
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.summary.errorRows, 2);
  assert.equal(plan.errors.length, 2);
  assert.ok(plan.errors.every((message) => /重複/.test(message)));
  resetEmployees();
});
