import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyPrintData, buildTransferPrintData, formatDuration } from "../js/print-data.js";

function sampleWorkspace() {
  return {
    name: "園芸売場",
    selectedMonth: "2026-07",
    employees: [
      { id: "e1", name: "田中", code: "E001", department: "園芸", order: 2 },
      { id: "e2", name: "佐藤", code: "E002", department: "資材", order: 1 }
    ],
    shiftTypes: [
      { code: "01", name: "01", shortLabel: "01", start: "09:00", end: "18:00", isWork: true, overtimeMinutes: 60 },
      { code: "休", name: "公休", shortLabel: "休", start: "", end: "", isWork: false, paidMinutes: 0, overtimeMinutes: 0 }
    ],
    shifts: {
      "2026-07": {
        e1: {
          "2026-07-01": "01",
          "2026-07-02": "休",
          "2026-07-03": "01",
          "2026-07-04": "01"
        },
        e2: { "2026-07-01": "休" }
      }
    },
    breaks: {
      "2026-07-01": {
        e1: [
          { type: "small", start: "11:00", end: "11:15" },
          { type: "lunch", start: "13:00", end: "14:00" },
          { type: "small", start: "16:15", end: "16:30" }
        ]
      },
      "2026-07-04": {
        e1: [{ type: "small", start: "08:30", end: "09:30" }]
      }
    }
  };
}

test("月間印刷データは従業員順とシフト略称を維持する", () => {
  const data = buildMonthlyPrintData(sampleWorkspace());
  assert.equal(data.days.length, 31);
  assert.deepEqual(data.rows.map((row) => row.name), ["佐藤", "田中"]);
  const tanaka = data.rows[1];
  assert.equal(tanaka.cells[0].label, "01");
  assert.equal(tanaka.cells[1].label, "休");
  assert.equal(tanaka.workDays, 3);
  assert.equal(tanaka.paidMinutes, 450 * 3);
  assert.equal(tanaka.overtimeMinutes, 60 * 3);
});

test("転記一覧は実際の90分休憩と7時間30分実働を表示する", () => {
  const data = buildTransferPrintData(sampleWorkspace());
  const firstDay = data.groups.find((group) => group.day === 1);
  const tanaka = firstDay.rows.find((row) => row.employeeId === "e1");
  assert.equal(tanaka.breakMinutes, 90);
  assert.equal(tanaka.workMinutes, 450);
  assert.equal(tanaka.breakText, "11:00–11:15 / 13:00–14:00 / 16:15–16:30");
  assert.equal(tanaka.status, "OK");
});

test("必要な休憩が未配置の場合は要確認として出力する", () => {
  const data = buildTransferPrintData(sampleWorkspace());
  const tanaka = data.groups.find((group) => group.day === 3).rows[0];
  assert.equal(tanaka.breakText, "未配置");
  assert.equal(tanaka.breakMinutes, 0);
  assert.equal(tanaka.workMinutes, 540);
  assert.equal(tanaka.status, "要確認");
});

test("勤務時間外にまたがる休憩は勤務内の部分だけ差し引く", () => {
  const data = buildTransferPrintData(sampleWorkspace());
  const tanaka = data.groups.find((group) => group.day === 4).rows[0];
  assert.equal(tanaka.breakMinutes, 30);
  assert.equal(tanaka.workMinutes, 510);
  assert.equal(tanaka.status, "要確認");
});

test("分数を時分形式へ整形する", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(45), "0:45");
  assert.equal(formatDuration(450), "7:30");
});
