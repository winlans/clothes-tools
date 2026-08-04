const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:1420";
const pdfFixture = process.env.PDF_FIXTURE ?? "/fixtures/input.pdf";
const expectedLayout = process.env.EXPECTED_LAYOUT;
const expectedPagesPerColumn = process.env.EXPECTED_PAGES_PER_COLUMN;
const expectedCells = process.env.EXPECTED_CELLS;

assert(expectedLayout, "EXPECTED_LAYOUT is required");
assert(expectedPagesPerColumn, "EXPECTED_PAGES_PER_COLUMN is required");
assert(expectedCells, "EXPECTED_CELLS is required");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.setInputFiles('input[type="file"]', pdfFixture);
    await page.getByText(expectedLayout, { exact: true }).waitFor({ timeout: 20000 });
    await page
      .getByText(`红线识别：每列 ${expectedPagesPerColumn} 页`, { exact: true })
      .waitFor({ timeout: 20000 });
    const result = {
      layout: await page.locator(".layout-toolbar__summary").textContent(),
      pagesPerColumn: await page
        .locator('.layout-toolbar input[type="number"]')
        .inputValue(),
      cells: await page.locator(".layout-canvas").getAttribute("data-layout-cells"),
      pageErrors,
    };
    assert.equal(result.layout, expectedLayout);
    assert.equal(result.pagesPerColumn, expectedPagesPerColumn);
    assert.equal(result.cells, expectedCells);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
