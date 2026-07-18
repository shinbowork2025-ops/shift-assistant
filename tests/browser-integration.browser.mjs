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

test("実ブラウザで保存安全性・月間編集・配置条件画面が動く", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("html[data-app-ready='1']");

  await page.waitForSelector(".storage-safety-summary");
  assert.match(await page.locator(".storage-safety-summary").innerText(), /保存保護/);
  const validationPanel = page.locator(".month-validation-panel");
  await validationPanel.waitFor();
  assert.match(await validationPanel.innerText(), /転記準備OK|要確認|入力途中/);
  assert.match(await validationPanel.innerText(), /未入力 \d+セル/);

  const validationDetails = validationPanel.locator(".month-validation-details");
  const issueCount = Number(await validationPanel.getAttribute("data-issue-count"));
  const initiallyOpen = await validationDetails.evaluate((element) => element.open);
  assert.equal(initiallyOpen, issueCount > 0 && issueCount <= 5);
  const validationSummary = validationDetails.locator(":scope > summary");
  if (!initiallyOpen) await validationSummary.click();
  await validationSummary.click();
  assert.equal(await validationDetails.evaluate((element) => element.open), false);
  await page.evaluate(async () => {
    const module = await import("/js/month-validation-ui.js");
    module.renderMonthValidationDashboard();
  });
  assert.equal(await page.locator(".month-validation-details").evaluate((element) => element.open), false);

  await page.waitForSelector(".month-edit-toolbar");
  assert.match(await page.locator(".month-edit-toolbar").innerText(), /通常入力/);
  assert.match(await page.locator(".month-edit-toolbar").innerText(), /希望休/);
  await page.waitForSelector(".month-view-controls");
  await page.getByRole("button", { name: "コンパクト表示" }).click();
  assert.equal(await page.locator("#tableContainer").evaluate((element) => element.classList.contains("month-compact")), true);
  assert.match(await page.locator(".employee-filter").innerText(), /従業員を絞り込む/);

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
