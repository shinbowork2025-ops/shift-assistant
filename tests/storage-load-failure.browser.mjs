import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 4174;
let server;
let browser;

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/index.html`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("テスト用HTTPサーバーを起動できませんでした。");
}

before(async () => {
  server = spawn(process.env.PYTHON_EXECUTABLE || "python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    stdio: "ignore"
  });
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
  });
});

after(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
});

test("保存データ読込失敗時は編集と自動保存を開始しない", async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const failingIndexedDb = {
      open() {
        const request = {
          result: null,
          error: new DOMException("simulated IndexedDB failure", "UnknownError"),
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
          onblocked: null
        };
        queueMicrotask(() => request.onerror?.());
        return request;
      }
    };
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: failingIndexedDb });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });
  await page.locator("#authUserId").fill("99999");
  await page.locator("#authPassword").fill("99999");
  await page.locator("#authSubmitButton").click();

  const fatalPanel = page.locator("#fatalStorageError");
  await fatalPanel.waitFor({ state: "visible" });
  assert.match(await fatalPanel.innerText(), /編集と自動保存を開始していません/);
  assert.equal(await page.locator("html").getAttribute("data-app-ready"), null);
  assert.equal(await page.locator("html").getAttribute("data-storage-load-failed"), "1");
  assert.equal(await page.locator("#monthPanel").isHidden(), true);
  assert.equal(await page.locator("#newWorkspaceButton").isHidden(), true);
  assert.equal(pageErrors.length, 0);

  await context.close();
});
