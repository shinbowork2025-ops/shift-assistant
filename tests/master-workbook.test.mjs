import test from "node:test";
import assert from "node:assert/strict";
import { prepareMasterWorkbookRows } from "../js/master-workbook.js";

test("通常シフトの名称空欄をコードで補い、休日区分を追加する", () => {
  const result = prepareMasterWorkbookRows([
    {
      sheetName: "マスターデータ",
      rows: [
        ["種別", "コード", "名称", "開始時刻", "終了時刻", "所属", "表示順", "略称"],
        ["従業員", "E001", "田中太郎", "", "", "園芸", "1", ""],
        ["シフト", "01", "", "06:45", "16:15", "", "", ""]
      ]
    },
    {
      sheetName: "休日区分・特殊シフト",
      rows: [
        ["コード", "名称", "入力例・補足"],
        ["7", "公休", ""],
        ["Y", "有給休暇", ""],
        ["Yシフト", "前半有給", "「Y」＋シフトコード"],
        ["シフトY", "後半有給", "シフトコード＋「Y」"],
        ["Jシフト", "開錠", "「J」＋シフトコード"]
      ]
    }
  ]);

  assert.equal(result.primarySheetName, "マスターデータ");
  assert.deepEqual(result.usedSheetNames, ["マスターデータ", "休日区分・特殊シフト"]);
  assert.equal(result.filledShiftNames, 1);
  assert.equal(result.supplementalShiftCount, 2);
  assert.equal(result.ignoredSupplementRows.length, 3);

  assert.deepEqual(result.rows[2], ["シフト", "01", "01", "06:45", "16:15", "", "", "01"]);
  assert.deepEqual(result.rows[3], ["シフト", "7", "公休", "", "", "", "", "7"]);
  assert.deepEqual(result.rows[4], ["シフト", "Y", "有給休暇", "", "", "", "", "Y"]);
});

test("休日区分シートがなくても通常マスターを読み込める", () => {
  const result = prepareMasterWorkbookRows([{
    sheetName: "Sheet1",
    rows: [
      ["種別", "コード", "名称"],
      ["シフト", "OFF", "公休"]
    ]
  }]);

  assert.equal(result.rows.length, 2);
  assert.equal(result.supplementalShiftCount, 0);
  assert.equal(result.ignoredSupplementRows.length, 0);
});

test("マスター用の見出しがない場合はエラーにする", () => {
  assert.throws(
    () => prepareMasterWorkbookRows([{ sheetName: "メモ", rows: [["項目", "内容"], ["a", "b"]] }]),
    /マスターデータ用シート/
  );
});
