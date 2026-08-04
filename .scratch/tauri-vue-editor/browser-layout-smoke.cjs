const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:1420";
const pdfFixture = process.env.PDF_FIXTURE ?? "/fixtures/input.pdf";
const screenshotPath = process.env.SCREENSHOT_PATH;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const consoleErrors = [];
  const wasmResponses = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().includes("wasm")) {
      wasmResponses.push({
        url: response.url(),
        status: response.status(),
        contentType: response.headers()["content-type"],
      });
    }
  });

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.setInputFiles('input[type="file"]', pdfFixture);
  try {
    await page.getByText("5 列 × 3 行").waitFor({ timeout: 10000 });
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          body: await page.locator("body").innerText(),
          pageErrors,
          consoleErrors,
          wasmResponses,
        },
        null,
        2,
      ),
    );
    throw error;
  }
  await page.waitForFunction(
    () => document.querySelectorAll(".page-thumbnail img").length === 15,
    undefined,
    { timeout: 30000 },
  );

  const canvas = page.locator(".layout-canvas");
  await canvas.locator("canvas").first().waitFor();
  const beforeZoom = await canvas.getAttribute("data-camera-scale");
  const box = await canvas.boundingBox();
  assert(box, "layout canvas must have a visible bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(100);
  const afterZoom = await canvas.getAttribute("data-camera-scale");
  assert.notEqual(afterZoom, beforeZoom, "wheel must update canvas zoom");

  const beforePan = await canvas.getAttribute("data-camera-x");
  await page.keyboard.down("Space");
  await page.mouse.down({ button: "left" });
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30);
  await page.mouse.up({ button: "left" });
  await page.keyboard.up("Space");
  const afterPan = await canvas.getAttribute("data-camera-x");
  assert.notEqual(afterPan, beforePan, "space plus left drag must pan the canvas");

  await page.getByRole("button", { name: "适合内容" }).click();
  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join("; ")}`);
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(
    JSON.stringify({
      pageCount: 15,
      layout: "5x3",
      canvases: await canvas.locator("canvas").count(),
      beforeZoom,
      afterZoom,
      beforePan,
      afterPan,
      pageErrors,
    }),
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
