import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 4175;
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

async function login(page) {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });
  await page.locator("#authUserId").fill("99999");
  await page.locator("#authPassword").fill("99999");
  await page.locator("#authSubmitButton").click();
  await page.waitForSelector("html[data-app-ready='1']");
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

test("保存・再読込・バックアップ復元を一連で確認する", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);

  assert.match(await page.locator("#authGate .auth-note").textContent(), /暗号化.*利用者の識別.*権限分離/);
  await page.locator("#solverMetricExplanation").waitFor();
  assert.match(await page.locator("#solverMetricExplanation").innerText(), /公平性スコア/);

  await page.evaluate(async () => {
    const model = await import("/js/model.js");
    model.updateActiveWorkspace("保存往復テスト", model.state.selectedMonth);
    await model.flushPendingSave();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("html[data-app-ready='1']");
  assert.match(await page.locator("#workspaceSelect").innerText(), /保存往復テスト/);

  const restoredName = await page.evaluate(async () => {
    const model = await import("/js/model.js");
    const backup = model.getApplicationBackup();
    model.updateActiveWorkspace("一時変更", model.state.selectedMonth);
    await model.flushPendingSave();
    await model.restoreApplicationState(backup);
    return model.getActiveWorkspace()?.name;
  });
  assert.equal(restoredName, "保存往復テスト");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("html[data-app-ready='1']");
  assert.match(await page.locator("#workspaceSelect").innerText(), /保存往復テスト/);
  assert.deepEqual(pageErrors, []);
  await context.close();
});