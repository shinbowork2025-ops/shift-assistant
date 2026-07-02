const UTF8_DECODER = new TextDecoder("utf-8");
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

function parseXml(text, label) {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error(`${label}のXMLを解析できませんでした。`);
  }
  return document;
}

function xmlElements(parent, localName) {
  return Array.from(parent.getElementsByTagNameNS("*", localName));
}

function firstXmlElement(parent, localName) {
  return xmlElements(parent, localName)[0] ?? null;
}

function normalizeZipPath(path) {
  const parts = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolveZipPath(baseFile, target) {
  if (target.startsWith("/")) return normalizeZipPath(target.slice(1));
  const slashIndex = baseFile.lastIndexOf("/");
  const baseDirectory = slashIndex >= 0 ? baseFile.slice(0, slashIndex + 1) : "";
  return normalizeZipPath(`${baseDirectory}${target}`);
}

function findEndOfCentralDirectory(view) {
  const minimumOffset = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw new Error("ExcelファイルのZIP終端情報が見つかりませんでした。");
}

function readZipDirectory(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error("ExcelファイルのZIPディレクトリが壊れています。");
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileNameStart = offset + 46;
    const fileName = normalizeZipPath(UTF8_DECODER.decode(bytes.subarray(fileNameStart, fileNameStart + fileNameLength)));

    entries.set(fileName, {
      compressionMethod,
      compressedSize,
      localHeaderOffset
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return { buffer, view, bytes, entries };
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("このブラウザはExcel展開に必要なDecompressionStreamへ対応していません。Chromeを更新してください。");
  }

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (error) {
    throw new Error(`Excelファイルの展開に失敗しました: ${error.message}`);
  }
}

async function extractZipEntry(zip, path, required = true) {
  const normalizedPath = normalizeZipPath(path);
  const entry = zip.entries.get(normalizedPath);
  if (!entry) {
    if (required) throw new Error(`Excelファイル内に ${normalizedPath} が見つかりません。`);
    return null;
  }

  const { view, bytes } = zip;
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== ZIP_LOCAL_SIGNATURE) {
    throw new Error(`${normalizedPath}のZIPヘッダーが壊れています。`);
  }

  const fileNameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return new Uint8Array(compressed);
  if (entry.compressionMethod === 8) return inflateRaw(compressed);
  throw new Error(`${normalizedPath}は未対応の圧縮方式です。`);
}

async function extractZipText(zip, path, required = true) {
  const bytes = await extractZipEntry(zip, path, required);
  return bytes ? UTF8_DECODER.decode(bytes) : null;
}

function relationshipMap(document) {
  const relationships = new Map();
  for (const relationship of xmlElements(document, "Relationship")) {
    relationships.set(relationship.getAttribute("Id"), relationship.getAttribute("Target"));
  }
  return relationships;
}

function parseSharedStrings(document) {
  if (!document) return [];
  return xmlElements(document, "si").map((item) =>
    xmlElements(item, "t").map((textNode) => textNode.textContent ?? "").join("")
  );
}

function parseStyles(document) {
  if (!document) return { styleFormats: [], customFormats: new Map() };

  const customFormats = new Map();
  for (const numberFormat of xmlElements(document, "numFmt")) {
    customFormats.set(Number(numberFormat.getAttribute("numFmtId")), numberFormat.getAttribute("formatCode") ?? "");
  }

  const cellXfs = firstXmlElement(document, "cellXfs");
  const styleFormats = cellXfs
    ? Array.from(cellXfs.children).filter((node) => node.localName === "xf").map((node) => Number(node.getAttribute("numFmtId")) || 0)
    : [];
  return { styleFormats, customFormats };
}

function isTimeNumberFormat(numberFormatId, customFormats) {
  if ([18, 19, 20, 21, 22, 45, 46, 47].includes(numberFormatId)) return true;
  const custom = customFormats.get(numberFormatId);
  if (!custom) return false;
  const cleaned = custom
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
  return /[hs]/i.test(cleaned) || /h+:?m+/i.test(cleaned);
}

function excelFractionToTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  const fraction = ((number % 1) + 1) % 1;
  let minutes = Math.round(fraction * 1440);
  if (minutes >= 1440) minutes = 0;
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function columnIndexFromReference(reference) {
  const match = String(reference ?? "").match(/^([A-Z]+)/i);
  if (!match) return null;
  let index = 0;
  for (const character of match[1].toUpperCase()) {
    index = index * 26 + character.charCodeAt(0) - 64;
  }
  return index - 1;
}

function cellText(cell, sharedStrings, styles) {
  const type = cell.getAttribute("t") ?? "n";
  const valueNode = firstXmlElement(cell, "v");
  const rawValue = valueNode?.textContent ?? "";

  if (type === "s") return sharedStrings[Number(rawValue)] ?? "";
  if (type === "inlineStr") {
    return xmlElements(cell, "t").map((textNode) => textNode.textContent ?? "").join("");
  }
  if (type === "str" || type === "e") return rawValue;
  if (type === "b") return rawValue === "1" ? "TRUE" : "FALSE";

  const styleIndex = Number(cell.getAttribute("s")) || 0;
  const numberFormatId = styles.styleFormats[styleIndex] ?? 0;
  if (rawValue && isTimeNumberFormat(numberFormatId, styles.customFormats)) {
    return excelFractionToTime(rawValue);
  }
  return rawValue;
}

function parseWorksheet(document, sharedStrings, styles) {
  const rows = [];
  for (const rowNode of xmlElements(document, "row")) {
    const values = [];
    let nextColumnIndex = 0;
    for (const cell of Array.from(rowNode.children).filter((node) => node.localName === "c")) {
      const referencedIndex = columnIndexFromReference(cell.getAttribute("r"));
      const columnIndex = referencedIndex ?? nextColumnIndex;
      values[columnIndex] = cellText(cell, sharedStrings, styles);
      nextColumnIndex = columnIndex + 1;
    }
    while (values.length && String(values.at(-1) ?? "").trim() === "") values.pop();
    if (values.some((value) => String(value ?? "").trim() !== "")) rows.push(values.map((value) => value ?? ""));
  }
  return rows;
}

export async function readFirstWorksheetRows(file) {
  const zip = readZipDirectory(await file.arrayBuffer());
  const workbookPath = "xl/workbook.xml";
  const workbookDocument = parseXml(await extractZipText(zip, workbookPath), "workbook.xml");
  const workbookRelationshipsDocument = parseXml(
    await extractZipText(zip, "xl/_rels/workbook.xml.rels"),
    "workbook.xml.rels"
  );
  const relationships = relationshipMap(workbookRelationshipsDocument);
  const firstSheet = firstXmlElement(workbookDocument, "sheet");
  if (!firstSheet) throw new Error("Excelファイルにワークシートがありません。");

  const relationshipId = firstSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")
    ?? firstSheet.getAttribute("r:id");
  const target = relationships.get(relationshipId);
  if (!target) throw new Error("先頭ワークシートの参照先が見つかりません。");
  const worksheetPath = resolveZipPath(workbookPath, target);

  const sharedStringsText = await extractZipText(zip, "xl/sharedStrings.xml", false);
  const stylesText = await extractZipText(zip, "xl/styles.xml", false);
  const sharedStrings = parseSharedStrings(sharedStringsText ? parseXml(sharedStringsText, "sharedStrings.xml") : null);
  const styles = parseStyles(stylesText ? parseXml(stylesText, "styles.xml") : null);
  const worksheetDocument = parseXml(await extractZipText(zip, worksheetPath), worksheetPath);
  const rows = parseWorksheet(worksheetDocument, sharedStrings, styles);
  if (rows.length < 2) throw new Error("Excelの先頭シートに見出し行とデータ行が必要です。");

  return {
    rows,
    sheetName: firstSheet.getAttribute("name") ?? "先頭シート"
  };
}
