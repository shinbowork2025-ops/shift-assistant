import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SAMPLE_MASTER_WORKBOOK_FILE_NAME,
  SAMPLE_MASTER_WORKBOOK_MIME_TYPE,
  sampleMasterWorkbookBytes
} from "../js/sample-master-workbook.js";

test("組み込みExcel見本がアップロード原本と同じ内容である", () => {
  const bytes = sampleMasterWorkbookBytes();
  assert.equal(SAMPLE_MASTER_WORKBOOK_FILE_NAME, "shift-assistant-master-sample.xlsx");
  assert.equal(SAMPLE_MASTER_WORKBOOK_MIME_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(bytes.length, 8750);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "029d191544f146e53f6460d58bf8cb73241e3f30a9d979b70f60b3f90e3ed398"
  );
});
