from __future__ import annotations

import base64
import io
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
TIME_FORMAT_IDS = {18, 19, 20, 21, 22, 45, 46, 47}


def read_embedded_workbook() -> bytes:
    source = Path("js/sample-master-workbook.js").read_text(encoding="utf-8")
    match = re.search(
        r"const SAMPLE_MASTER_WORKBOOK_BASE64 = \[(.*?)\]\.join\(\"\"\);",
        source,
        flags=re.DOTALL,
    )
    if not match:
        raise RuntimeError("embedded workbook base64 not found")
    fragments = re.findall(r'"([A-Za-z0-9+/=]+)"', match.group(1))
    return base64.b64decode("".join(fragments))


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference or "")
    if not letters:
        return 0
    value = 0
    for character in letters.group(0):
        value = value * 26 + ord(character) - 64
    return value - 1


def time_text(value: str) -> str:
    fraction = float(value) % 1
    minutes = round(fraction * 1440) % 1440
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def inspect_workbook(data: bytes) -> dict:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_targets = {
            item.attrib["Id"]: item.attrib["Target"]
            for item in relationships.findall(f"{{{NS_PKG_REL}}}Relationship")
        }

        shared_strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in shared_root.findall(f"{{{NS_MAIN}}}si"):
                shared_strings.append("".join(node.text or "" for node in item.iter() if local_name(node.tag) == "t"))

        style_formats = []
        if "xl/styles.xml" in archive.namelist():
            styles_root = ET.fromstring(archive.read("xl/styles.xml"))
            cell_xfs = styles_root.find(f"{{{NS_MAIN}}}cellXfs")
            if cell_xfs is not None:
                style_formats = [int(item.attrib.get("numFmtId", "0")) for item in cell_xfs]

        sheets = []
        sheets_parent = workbook.find(f"{{{NS_MAIN}}}sheets")
        for sheet in list(sheets_parent or []):
            name = sheet.attrib.get("name", "Sheet")
            rel_id = sheet.attrib.get(f"{{{NS_REL}}}id")
            target = rel_targets[rel_id].lstrip("/")
            if not target.startswith("xl/"):
                target = f"xl/{target}"
            root = ET.fromstring(archive.read(target))
            rows = []
            for row_node in root.iter(f"{{{NS_MAIN}}}row"):
                values = []
                for cell in list(row_node):
                    if local_name(cell.tag) != "c":
                        continue
                    index = column_index(cell.attrib.get("r", ""))
                    while len(values) <= index:
                        values.append("")
                    cell_type = cell.attrib.get("t", "n")
                    raw_node = next((node for node in cell if local_name(node.tag) == "v"), None)
                    raw = raw_node.text if raw_node is not None and raw_node.text is not None else ""
                    if cell_type == "s" and raw:
                        value = shared_strings[int(raw)]
                    elif cell_type == "inlineStr":
                        value = "".join(node.text or "" for node in cell.iter() if local_name(node.tag) == "t")
                    else:
                        style_index = int(cell.attrib.get("s", "0"))
                        format_id = style_formats[style_index] if style_index < len(style_formats) else 0
                        value = time_text(raw) if raw and format_id in TIME_FORMAT_IDS else raw
                    values[index] = value
                while values and values[-1] == "":
                    values.pop()
                if any(str(value).strip() for value in values):
                    rows.append(values)
            sheets.append({"sheetName": name, "rows": rows})
        return {"size": len(data), "worksheets": sheets}


print(json.dumps(inspect_workbook(read_embedded_workbook()), ensure_ascii=False, indent=2))
