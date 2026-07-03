import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// elements.jsのIDが1つでもindex.htmlと食い違うと、bindEvents()がnull参照で
// 失敗しアプリ全体が起動しなくなる。ここで静的に突き合わせて防ぐ。
test("elements.jsのelementIdsがすべてindex.htmlに存在する", async () => {
  const elementsSource = await readFile(path.join(repositoryRoot, "js", "elements.js"), "utf8");
  const arrayMatch = elementsSource.match(/const elementIds = \[([\s\S]*?)\];/);
  assert.ok(arrayMatch, "elements.jsからelementIds配列を抽出できませんでした");

  const ids = [...arrayMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.length >= 50, `elementIdsの抽出件数が想定より少なすぎます: ${ids.length}件`);

  const html = await readFile(path.join(repositoryRoot, "index.html"), "utf8");
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

  const missing = ids.filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `index.htmlに存在しないID:\n${missing.join("\n")}`);

  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicated, [], `elementIdsに重複したID:\n${duplicated.join("\n")}`);
});
