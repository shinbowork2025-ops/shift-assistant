import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeMasterShiftRows } from "../js/master-shift-code-normalizer.js";

test("マスター取込の公休コード7とoffを休へ統一する", () => {
  const rows = canonicalizeMasterShiftRows([
    ["種別", "コード", "名称", "開始時刻", "終了時刻", "略称"],
    ["シフト", "7", "公休", "", "", "7"],
    ["シフト", "off", "公休", "", "", "OFF"],
    ["シフト", "07", "07", "08:45", "20:15", "07"]
  ]);

  assert.deepEqual(rows[1], ["シフト", "休", "公休", "", "", "休"]);
  assert.deepEqual(rows[2], ["シフト", "休", "公休", "", "", "休"]);
  assert.deepEqual(rows[3], ["シフト", "07", "07", "08:45", "20:15", "07"]);
});

test("従業員コード7は変更しない", () => {
  const rows = canonicalizeMasterShiftRows([
    ["種別", "コード", "名称", "開始時刻", "終了時刻"],
    ["従業員", "7", "公休", "", ""]
  ]);
  assert.equal(rows[1][1], "7");
});
