from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old in text:
        target.write_text(text.replace(old, new), encoding="utf-8")


replace(
    "README.md",
    "S01,早番,09:00,18:00,早,1",
    "01,01,06:45,16:15,01,0\n休,公休,,,,休,0",
)

replace(
    "js/csv.js",
    "export const SAMPLE_MASTER_CSV = `種別,コード,名称,開始時刻,終了時刻,所属,表示順,略称,固定残業時間,シフト残業時間\\r\\n従業員,E001,田中太郎,,,園芸,1,,20,\\r\\n従業員,E002,佐藤花子,,,資材,2,,10,\\r\\nシフト,S01,早番,09:00,18:00,,,早,,1\\r\\nシフト,S02,遅番,12:00,21:00,,,遅,,0.5\\r\\nシフト,OFF,公休,,,,,休,,0\\r\\n`;",
    "export const SAMPLE_MASTER_CSV = `種別,コード,名称,開始時刻,終了時刻,所属,表示順,略称,固定残業時間,シフト残業時間\\r\\n従業員,E001,田中太郎,,,園芸,1,,20,\\r\\n従業員,E002,佐藤花子,,,資材,2,,10,\\r\\nシフト,01,01,06:45,16:15,,,01,,0\\r\\nシフト,02,02,06:45,17:45,,,02,,0\\r\\nシフト,07,07,08:45,20:15,,,07,,0\\r\\nシフト,休,公休,,,,,休,,0\\r\\nシフト,Y,有給休暇,,,,,Y,,0\\r\\n`;",
)

replacements = {
    "tests/print-data.test.mjs": [
        ('{ code: "early", name: "早番", shortLabel: "早", start: "09:00", end: "18:00", isWork: true, overtimeMinutes: 60 }', '{ code: "01", name: "01", shortLabel: "01", start: "09:00", end: "18:00", isWork: true, overtimeMinutes: 60 }'),
        ('{ code: "off", name: "公休", shortLabel: "休", start: "", end: "", isWork: false, paidMinutes: 0, overtimeMinutes: 0 }', '{ code: "休", name: "公休", shortLabel: "休", start: "", end: "", isWork: false, paidMinutes: 0, overtimeMinutes: 0 }'),
        ('"early"', '"01"'),
        ('"off"', '"休"'),
        ('assert.equal(tanaka.cells[0].label, "早");', 'assert.equal(tanaka.cells[0].label, "01");'),
    ],
    "tests/daily-overview.test.mjs": [
        ('{ code: "early", name: "早番", start: "09:00", end: "18:00", isWork: true }', '{ code: "01", name: "01", start: "09:00", end: "18:00", isWork: true }'),
        ('"early"', '"01"'),
    ],
    "tests/auto-work-shifts.test.mjs": [
        ('{ code: "E", name: "早番", shortLabel: "早",', '{ code: "E", name: "勤務E", shortLabel: "E",'),
        ('{ code: "M", name: "中番", shortLabel: "中",', '{ code: "M", name: "勤務M", shortLabel: "M",'),
        ('{ code: "L", name: "遅番", shortLabel: "遅",', '{ code: "L", name: "勤務L", shortLabel: "L",'),
        ('{ code: "7", name: "公休", shortLabel: "休",', '{ code: "休", name: "公休", shortLabel: "休",'),
        ('"7"', '"休"'),
        ('test("遅番の翌日は早番を避ける"', 'test("終了が遅い勤務の翌日は開始が早い勤務を避ける"'),
    ],
    "tests/month-overview.test.mjs": [
        ('{ code: "early", name: "早番", start: "09:00", end: "18:00", isWork: true, overtimeMinutes: 60 }', '{ code: "01", name: "01", start: "09:00", end: "18:00", isWork: true, overtimeMinutes: 60 }'),
        ('{ code: "off", name: "公休", start: "", end: "", isWork: false, paidMinutes: 0, overtimeMinutes: 0 }', '{ code: "休", name: "公休", start: "", end: "", isWork: false, paidMinutes: 0, overtimeMinutes: 0 }'),
        ('"early"', '"01"'),
        ('"off"', '"休"'),
    ],
    "tests/auto-days-off.test.mjs": [
        ('{ code: "01", name: "早番", isWork: true }', '{ code: "01", name: "01", isWork: true }'),
        ('{ code: "7", name: "公休", isWork: false }', '{ code: "休", name: "公休", isWork: false }'),
        ('"7"', '"休"'),
    ],
    "tests/shift-metrics.test.mjs": [
        ('code: "early",\n  name: "早番",', 'code: "01",\n  name: "01",'),
    ],
    "tests/workspace-schema.test.mjs": [
        ('{ code: "early", name: "早番", start: "09:00", end: "18:00", isWork: true }', '{ code: "01", name: "01", start: "09:00", end: "18:00", isWork: true }'),
        ('"early"', '"01"'),
    ],
}

for path, items in replacements.items():
    for old, new in items:
        replace(path, old, new)
