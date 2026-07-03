import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetExtensions = new Set([".js", ".mjs", ".css", ".html", ".md"]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(fullPath));
    else if (targetExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

// 文字化けしたコミットが混入すると、node --checkを通ってもブラウザ側の
// モジュール解析が失敗し、アプリ全体が起動しなくなる。
// 全ソースがUTF-8として完全に往復できることを検査して混入を防ぐ。
test("全ソースファイルが正しいUTF-8で、置換文字を含まない", async () => {
  const problems = [];
  for (const file of await collectFiles(repositoryRoot)) {
    const bytes = await readFile(file);
    const text = bytes.toString("utf8");
    const relative = path.relative(repositoryRoot, file);
    if (!Buffer.from(text, "utf8").equals(bytes)) {
      problems.push(`${relative}: UTF-8として不正なバイト列があります`);
      continue;
    }
    const replacementIndex = text.indexOf("\uFFFD");
    if (replacementIndex >= 0) {
      const line = text.slice(0, replacementIndex).split("\n").length;
      problems.push(`${relative}:${line}: 置換文字（U+FFFD）が含まれています`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});
