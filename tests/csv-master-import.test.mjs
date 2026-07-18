import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/model.js";
import { importMasterRows } from "../js/csv.js";

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
