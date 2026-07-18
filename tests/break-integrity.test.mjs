import test from "node:test";
import assert from "node:assert/strict";
import { breaksFitShiftWindow } from "../js/break-rules.js";
import { findBrokenBreakAssignments } from "../js/break-integrity.js";

const workShift = { code: "01", name: "早番", start: "06:45", end: "16:15", isWork: true };
const holiday = { code: "休", name: "公休", start: "", end: "", isWork: false };

test("breaksFitShiftWindowは勤務時間の内側だけを許容する", () => {
  assert.equal(breaksFitShiftWindow(workShift, [{ start: "12:00", end: "13:00" }]), true);
  assert.equal(breaksFitShiftWindow(workShift, []), true);

  // 勤務枠の外・境界に接する・逆転はすべて不可
  assert.equal(breaksFitShiftWindow(workShift, [{ start: "17:00", end: "18:00" }]), false);
  assert.equal(breaksFitShiftWindow(workShift, [{ start: "06:45", end: "07:00" }]), false);
  assert.equal(breaksFitShiftWindow(workShift, [{ start: "16:00", end: "16:15" }]), false);
  assert.equal(breaksFitShiftWindow(workShift, [{ start: "13:00", end: "12:00" }]), false);
  assert.equal(breaksFitShiftWindow(workShift, [
    { start: "12:00", end: "13:00" },
    { start: "17:00", end: "17:15" }
  ]), false);

  // 休日区分・不正なシフトは常に不可
  assert.equal(breaksFitShiftWindow(holiday, [{ start: "12:00", end: "13:00" }]), false);
  assert.equal(breaksFitShiftWindow(null, []), false);
});

test("findBrokenBreakAssignmentsは勤務枠外の休憩と残留休憩を列挙する", () => {
  const workspace = {
    shiftTypes: [workShift, holiday],
    shifts: {
      "2026-07": {
        e1: { "2026-07-01": "01" },
        e2: { "2026-07-01": "01" },
        e3: { "2026-07-01": "休" }
      }
    },
    breaks: {
      "2026-07-01": {
        e1: [{ start: "12:00", end: "13:00" }],
        e2: [{ start: "17:00", end: "18:00" }],
        e3: [{ start: "12:00", end: "13:00" }]
      },
      "2026-07-02": {
        e1: [{ start: "12:00", end: "13:00" }]
      }
    }
  };

  const broken = findBrokenBreakAssignments(workspace);
  const byDate = new Map(broken.map((item) => [item.dateValue, item.employeeIds]));

  // e1は正常、e2は勤務枠外、e3は休日に休憩が残留
  assert.deepEqual(byDate.get("2026-07-01").sort(), ["e2", "e3"]);
  // 7/2はシフト未入力なのに休憩だけが残っている
  assert.deepEqual(byDate.get("2026-07-02"), ["e1"]);
});

test("整合している場合は空配列を返す", () => {
  const broken = findBrokenBreakAssignments({
    shiftTypes: [workShift],
    shifts: { "2026-07": { e1: { "2026-07-01": "01" } } },
    breaks: { "2026-07-01": { e1: [{ start: "12:00", end: "13:00" }] } }
  });
  assert.deepEqual(broken, []);
});
