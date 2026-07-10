import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 4173;
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
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    stdio: "ignore"
  });
  await waitForServer();
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
});

test("実ブラウザで保存安全性・月間検証・配置条件画面が動く", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("html[data-app-ready='1']");

  await page.waitForSelector(".storage-safety-summary");
  assert.match(await page.locator(".storage-safety-summary").innerText(), /保存保護/);
  await page.waitForSelector(".month-validation-panel");
  assert.match(await page.locator(".month-validation-panel").innerText(), /転記準備OK|要確認/);
  await page.waitForSelector(".off-request-panel");
  assert.match(await page.locator(".off-request-panel").innerText(), /希望休だけ解除/);

  await page.click("#dayViewButton");
  await page.click("#coverageRequirementButton");
  const dialog = page.locator("dialog.staffing-dialog");
  await dialog.waitFor({ state: "visible" });
  const dialogText = await dialog.innerText();
  assert.match(dialogText, /必要部門/);
  assert.match(dialogText, /必要資格/);
  assert.match(dialogText, /配置条件CSVを読込/);
  assert.match(dialogText, /従業員の保有資格/);
  await dialog.getByRole("button", { name: "閉じる" }).click();

  assert.deepEqual(pageErrors, []);
  await context.close();
});
