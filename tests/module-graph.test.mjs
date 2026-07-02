import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const javascriptRoot = path.join(repositoryRoot, "js");

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJavaScriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(fullPath);
  }
  return files;
}

function relativeSpecifiers(source) {
  const patterns = [
    /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g,
    /import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g
  ];
  const results = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) results.add(match[1]);
  }
  return [...results];
}

async function existsAsFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

test("全JavaScriptモジュールの相対import先が存在する", async () => {
  const files = await collectJavaScriptFiles(javascriptRoot);
  const missing = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const specifier of relativeSpecifiers(source)) {
      const resolved = path.resolve(path.dirname(file), specifier);
      const candidates = path.extname(resolved)
        ? [resolved]
        : [`${resolved}.js`, path.join(resolved, "index.js")];
      if (!await Promise.any(candidates.map(async (candidate) => {
        if (await existsAsFile(candidate)) return true;
        throw new Error("not found");
      })).catch(() => false)) {
        missing.push(`${path.relative(repositoryRoot, file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(missing, [], `存在しないモジュール参照:\n${missing.join("\n")}`);
});
