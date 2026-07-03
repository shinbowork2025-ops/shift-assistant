import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SAMPLE_MASTER_WORKBOOK_FILE_NAME,
  SAMPLE_MASTER_WORKBOOK_MIME_TYPE,
  sampleMasterWorkbookBytes
} from "../js/sample-master-workbook.js";

test("組み込みExcel見本が新しいシフトコード仕様を保持する", () => {
  const bytes = sampleMasterWorkbookBytes();
  assert.equal(SAMPLE_MASTER_WORKBOOK_FILE_NAME, "shift-assistant-master-sample.xlsx");
  assert.equal(SAMPLE_MASTER_WORKBOOK_MIME_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(bytes.length, 6573);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "6337815721c7ee96a0769699bef3e57f0ee2d44882f91cff935386d5da9b78c0"
  );
});
