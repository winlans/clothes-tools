const assert = require("node:assert/strict");
const { readFile, readdir } = require("node:fs/promises");
const { chromium } = require("playwright");

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:1420";
const pdfFixture = process.env.PDF_FIXTURE ?? "/fixtures/input.pdf";
const screenshotPath = process.env.SCREENSHOT_PATH;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  async function rendererHeapMb() {
    const result = await cdp.send("Performance.getMetrics");
    const bytes = result.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0;
    return Number((bytes / 1024 / 1024).toFixed(2));
  }
  async function rendererRssMb() {
    let totalKb = 0;
    for (const entry of await readdir("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const command = await readFile(`/proc/${entry}/cmdline`, "utf8");
        if (!/chrom(?:e|ium)/i.test(command) || !command.includes("--type=renderer")) continue;
        const status = await readFile(`/proc/${entry}/status`, "utf8");
        totalKb += Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] ?? 0);
      } catch {
        // A process may exit between listing and reading /proc.
      }
    }
    return Number((totalKb / 1024).toFixed(2));
  }
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
  const importStarted = Date.now();
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
    () => document.querySelectorAll(".page-thumbnail img").length >= 1,
    undefined,
    { timeout: 3000 },
  );
  const firstPreviewMs = Date.now() - importStarted;
  const canvas = page.locator(".layout-canvas");
  await canvas.locator("canvas").first().waitFor();
  await canvas.scrollIntoViewIfNeeded();
  const previewResponsiveScale = await canvas.getAttribute("data-camera-scale");
  const previewResponsiveBox = await canvas.boundingBox();
  assert(previewResponsiveBox, "canvas must exist while previews are still rendering");
  await page.mouse.move(
    previewResponsiveBox.x + previewResponsiveBox.width / 2,
    previewResponsiveBox.y + previewResponsiveBox.height / 2,
  );
  await page.mouse.wheel(0, -80);
  await page.waitForFunction(
    (before) =>
      document.querySelector(".layout-canvas")?.getAttribute("data-camera-scale") !== before,
    previewResponsiveScale,
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".page-thumbnail img").length === 15,
    undefined,
    { timeout: 30000 },
  );
  const fullPreviewMs = Date.now() - importStarted;
  assert(firstPreviewMs < 3000, `first preview took ${firstPreviewMs}ms`);
  assert(fullPreviewMs < 15000, `full preview took ${fullPreviewMs}ms`);
  const previewHeapMb = await rendererHeapMb();
  const previewRssMb = await rendererRssMb();
  assert(previewHeapMb < 500, `renderer heap after preview was ${previewHeapMb}MB`);
  assert(previewRssMb < 500, `renderer RSS after preview was ${previewRssMb}MB`);

  await page.getByText("四条拼接线已检测，可直接微调。").waitFor();
  const detectedGuides = {};
  for (const [direction, name] of [
    ["left", "左拼接线 point 坐标"],
    ["right", "右拼接线 point 坐标"],
    ["top", "上拼接线 point 坐标"],
    ["bottom", "下拼接线 point 坐标"],
  ]) {
    detectedGuides[direction] = Number(await page.getByRole("spinbutton", { name }).inputValue());
  }
  assert(Math.abs(detectedGuides.left - 21.997) < 1);
  assert(Math.abs(detectedGuides.right - 818.893) < 1);
  assert(Math.abs(detectedGuides.top - 21.992) < 1);
  assert(Math.abs(detectedGuides.bottom - 1166.56) < 1);
  assert.equal(await page.getByLabel("成品尺寸").textContent(), "1421.51 × 1227.56 mm");
  assert.equal(await page.getByRole("button", { name: "手动", exact: true }).count(), 0);
  const seamCropping = page.getByRole("checkbox", { name: "裁切页间接缝" });
  assert.equal(await seamCropping.isChecked(), true);
  await seamCropping.uncheck();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="成品尺寸"]')?.textContent === "1485.00 × 1260.00 mm",
  );
  await seamCropping.check();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="成品尺寸"]')?.textContent === "1421.51 × 1227.56 mm",
  );
  await page.getByRole("button", { name: "完整页面" }).click();
  const layoutBeforeCropToggle = await canvas.getAttribute("data-layout-cells");
  await page.getByRole("button", { name: "成品裁切" }).click();
  await page.waitForFunction(
    () => document.querySelector(".layout-canvas")?.getAttribute("data-preview-mode") === "cropped",
  );
  const croppedContent = {
    width: Number(await canvas.getAttribute("data-content-width")),
    height: Number(await canvas.getAttribute("data-content-height")),
  };
  assert(croppedContent.width < 841.89 * 5);
  assert(croppedContent.height < 1190.551 * 3);
  assert.equal(await canvas.getAttribute("data-layout-cells"), layoutBeforeCropToggle);
  await page.getByRole("button", { name: "完整页面" }).click();
  await page.waitForFunction(
    () => document.querySelector(".layout-canvas")?.getAttribute("data-preview-mode") === "full",
  );

  await canvas.scrollIntoViewIfNeeded();
  const responsiveScaleBefore = await canvas.getAttribute("data-camera-scale");
  const responsiveBox = await canvas.boundingBox();
  assert(responsiveBox, "canvas must be visible during export");
  const exportStarted = Date.now();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 SVG" }).click();
  await page.getByRole("button", { name: "取消导出" }).waitFor();
  await page.mouse.move(
    responsiveBox.x + responsiveBox.width / 2,
    responsiveBox.y + responsiveBox.height / 2,
  );
  await page.mouse.wheel(0, -120);
  await page.waitForFunction(
    (before) =>
      document.querySelector(".layout-canvas")?.getAttribute("data-camera-scale") !== before,
    responsiveScaleBefore,
  );
  const download = await downloadPromise;
  const exportMs = Date.now() - exportStarted;
  assert(exportMs < 15000, `SVG export took ${exportMs}ms`);
  const exportedSvg = await readFile(await download.path(), "utf8");
  const ids = [...exportedSvg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const references = [
    ...exportedSvg.matchAll(/url\(#([^\)]+)\)/g),
    ...exportedSvg.matchAll(/(?:xlink:)?href="#([^"]+)"/g),
  ].map((match) => match[1]);
  assert.equal((exportedSvg.match(/<svg\b/g) ?? []).length, 1);
  assert.equal((exportedSvg.match(/data-page=/g) ?? []).length, 15);
  assert.equal((exportedSvg.match(/<image\b/g) ?? []).length, 0);
  assert.equal(new Set(ids).size, ids.length, "exported SVG IDs must be unique");
  assert(references.every((reference) => new Set(ids).has(reference)));
  assert(!exportedSvg.includes('stroke="#ff0000"'));
  assert(!exportedSvg.includes('fill="#ffffff"'));
  assert(exportedSvg.includes('viewBox="0 0 4029.473586 3479.687758"'));
  await page.getByText(/SVG 已生成：15 个页面实例/).waitFor();
  const svgExport = {
    bytes: Buffer.byteLength(exportedSvg),
    rootCount: 1,
    pageInstances: 15,
    uniqueIds: ids.length,
    references: references.length,
  };

  await page.getByLabel("保留红色辅助线").check();
  await page.getByLabel("保留白色背景").check();
  const keptDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 SVG" }).click();
  const keptDownload = await keptDownloadPromise;
  const keptSvg = await readFile(await keptDownload.path(), "utf8");
  assert(keptSvg.includes('stroke="#ff0000"'));
  assert(keptSvg.includes('fill="#ffffff"'));
  await page.getByLabel("保留红色辅助线").uncheck();
  await page.getByLabel("保留白色背景").uncheck();

  let cancelledExportDownloads = 0;
  const countCancelledDownload = () => {
    cancelledExportDownloads += 1;
  };
  page.on("download", countCancelledDownload);
  await page.getByRole("button", { name: "导出 SVG" }).click();
  await page.getByRole("button", { name: "取消导出" }).click();
  await page.getByText("SVG 导出已取消，未写入输出文件。").waitFor();
  await page.waitForTimeout(250);
  page.off("download", countCancelledDownload);
  assert.equal(cancelledExportDownloads, 0);

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
  const pageWidth = Number(await canvas.getAttribute("data-page-width"));
  const pageHeight = Number(await canvas.getAttribute("data-page-height"));
  const pageDimensionsBefore = { pageWidth, pageHeight };

  async function cellCenter(row, column) {
    const currentBox = await canvas.boundingBox();
    assert(currentBox, "layout canvas must remain visible");
    const scale = Number(await canvas.getAttribute("data-camera-scale"));
    const cameraX = Number(await canvas.getAttribute("data-camera-x"));
    const cameraY = Number(await canvas.getAttribute("data-camera-y"));
    return {
      x: currentBox.x + cameraX + (column * pageWidth + pageWidth / 2) * scale,
      y: currentBox.y + cameraY + (row * pageHeight + pageHeight / 2) * scale,
    };
  }

  const firstPage = await cellCenter(0, 0);
  const fifthCell = await cellCenter(1, 1);
  await page.mouse.move(firstPage.x, firstPage.y);
  await page.mouse.down();
  await page.mouse.move(fifthCell.x, fifthCell.y, { steps: 8 });
  assert.equal(await canvas.getAttribute("data-drop-row"), "1");
  assert.equal(await canvas.getAttribute("data-drop-column"), "1");
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document.querySelector(".layout-canvas")?.getAttribute("data-layout-cells") ===
      "2,3,4,5,1,6,7,8,9,10,11,12,13,14,15",
  );
  const movedLayout = await canvas.getAttribute("data-layout-cells");

  const lastPage = await cellCenter(2, 4);
  const firstCell = await cellCenter(0, 0);
  await page.mouse.move(lastPage.x, lastPage.y);
  await page.mouse.down();
  await page.mouse.move(firstCell.x, firstCell.y, { steps: 8 });
  assert.equal(await canvas.getAttribute("data-dragging-page"), "15");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await canvas.getAttribute("data-layout-cells"), movedLayout);
  assert.equal(await canvas.getAttribute("data-dragging-page"), null);
  assert.deepEqual(
    {
      pageWidth: Number(await canvas.getAttribute("data-page-width")),
      pageHeight: Number(await canvas.getAttribute("data-page-height")),
    },
    pageDimensionsBefore,
  );

  const spacerTarget = await cellCenter(0, 0);
  const spacerCanvasBox = await canvas.boundingBox();
  assert(spacerCanvasBox, "layout canvas must remain visible for spacer drop");
  await page.locator(".spacer-tool").dragTo(canvas, {
    targetPosition: {
      x: spacerTarget.x - spacerCanvasBox.x,
      y: spacerTarget.y - spacerCanvasBox.y,
    },
  });
  await page.waitForFunction(() =>
    document
      .querySelector(".layout-canvas")
      ?.getAttribute("data-layout-cells")
      ?.startsWith("S,2,3,4,5,1,6"),
  );
  assert.equal(await canvas.getAttribute("data-layout-columns"), "6");
  const spacerLayout = await canvas.getAttribute("data-layout-cells");

  await page.getByRole("button", { name: "撤销" }).click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector(".layout-canvas")?.getAttribute("data-layout-cells") ===
      expected,
    movedLayout,
  );
  await page.getByRole("button", { name: "重做" }).click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector(".layout-canvas")?.getAttribute("data-layout-cells") ===
      expected,
    spacerLayout,
  );

  const spacerSource = await cellCenter(0, 0);
  const spacerDestination = await cellCenter(2, 5);
  await page.mouse.move(spacerSource.x, spacerSource.y);
  await page.mouse.down();
  await page.mouse.move(spacerDestination.x, spacerDestination.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() =>
    document
      .querySelector(".layout-canvas")
      ?.getAttribute("data-layout-cells")
      ?.endsWith("-,-,S"),
  );

  const savedLayout = await canvas.getAttribute("data-layout-cells");
  const savedCamera = {
    scale: Number(await canvas.getAttribute("data-camera-scale")),
    x: Number(await canvas.getAttribute("data-camera-x")),
    y: Number(await canvas.getAttribute("data-camera-y")),
  };
  const projectDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存工程" }).click();
  const projectDownload = await projectDownloadPromise;
  const projectPath = await projectDownload.path();
  assert(projectPath, "saved project must have a local download path");
  const savedProject = JSON.parse(await readFile(projectPath, "utf8"));
  assert.equal(savedProject.schemaVersion, 1);
  assert.match(savedProject.source.sha256, /^[a-f0-9]{64}$/);
  assert(savedProject.layout.cells.flat().some((cell) => cell?.kind === "spacer"));
  assert.deepEqual(savedProject.view, {
    zoom: savedCamera.scale,
    panX: savedCamera.x,
    panY: savedCamera.y,
  });
  assert(Math.abs(savedProject.guides.seamLeft - detectedGuides.left) < 0.01);

  const projectChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "打开工程" }).click();
  const projectChooser = await projectChooserPromise;
  const pdfChooserPromise = page.waitForEvent("filechooser");
  await projectChooser.setFiles(projectPath);
  const pdfChooser = await pdfChooserPromise;
  await pdfChooser.setFiles(pdfFixture);
  await page.getByText(/工程已打开：/).waitFor({ timeout: 30000 });
  await page.waitForFunction(
    (expected) =>
      document.querySelector(".layout-canvas")?.getAttribute("data-layout-cells") === expected,
    savedLayout,
  );
  await page.waitForFunction(
    (expected) => {
      const element = document.querySelector(".layout-canvas");
      return element
        && Number(element.getAttribute("data-camera-scale")) === expected.scale
        && Number(element.getAttribute("data-camera-x")) === expected.x
        && Number(element.getAttribute("data-camera-y")) === expected.y;
    },
    savedCamera,
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".page-thumbnail img").length === 15,
    undefined,
    { timeout: 15000 },
  );
  assert(
    Math.abs(
      Number(await page.getByRole("spinbutton", { name: "左拼接线 point 坐标" }).inputValue())
        - savedProject.guides.seamLeft,
    ) < 0.001,
  );
  await page.getByRole("button", { name: "完整页面" }).click();
  await page.waitForFunction(
    () => document.querySelector(".layout-canvas")?.getAttribute("data-preview-mode") === "full",
  );
  await page.getByRole("button", { name: "适合内容" }).click();
  await canvas.evaluate((element) => element.scrollIntoView({ block: "start" }));

  const movedSpacerPosition = await cellCenter(2, 5);
  await page.mouse.dblclick(movedSpacerPosition.x, movedSpacerPosition.y);
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".layout-canvas")
        ?.getAttribute("data-layout-cells")
        ?.includes("S"),
  );
  const pagesAfterSpacerDelete = (await canvas.getAttribute("data-layout-cells"))
    ?.split(",")
    .filter((cell) => cell !== "-")
    .map(Number)
    .sort((a, b) => a - b);
  assert.deepEqual(pagesAfterSpacerDelete, Array.from({ length: 15 }, (_, i) => i + 1));

  await page.getByRole("button", { name: "删除最后一列" }).click();
  await page.waitForFunction(
    () => document.querySelector(".layout-canvas")?.getAttribute("data-layout-columns") === "5",
  );
  await page.getByRole("button", { name: "删除最后一列" }).click();
  await page.getByText("最后一列仍有页面或空白块，不能删除。").waitFor();

  const repeatedOpenHeapMb = [];
  const repeatedOpenRssMb = [];
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByText("导入分块版图").waitFor();
    await page.setInputFiles('input[type="file"]', pdfFixture);
    await page.waitForFunction(
      () => document.querySelectorAll(".page-thumbnail img").length === 15,
      undefined,
      { timeout: 15000 },
    );
    await cdp.send("HeapProfiler.collectGarbage");
    repeatedOpenHeapMb.push(await rendererHeapMb());
    repeatedOpenRssMb.push(await rendererRssMb());
  }
  assert(repeatedOpenHeapMb.every((value) => value < 500));
  assert(
    (repeatedOpenHeapMb.at(-1) ?? 0) <= (repeatedOpenHeapMb[0] ?? 0) + 50,
    `renderer heap kept growing: ${repeatedOpenHeapMb.join(", ")}MB`,
  );

  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByText("导入分块版图").waitFor();
  await page.setInputFiles('input[type="file"]', pdfFixture);
  const cancelPreviewButton = page.getByRole("button", { name: "取消预览" });
  await cancelPreviewButton.waitFor({ timeout: 3000 });
  await cancelPreviewButton.click();
  await cancelPreviewButton.waitFor({ state: "hidden" });
  const previewsAtCancellation = await page.locator(".page-thumbnail img").count();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".page-thumbnail img").count(), previewsAtCancellation);
  assert(previewsAtCancellation < 15, "preview cancellation should stop before all pages render");

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
      movedLayout,
      cancelledDragPreservedLayout: true,
      spacerInsertedAndExpanded: true,
      spacerUndoRedo: true,
      spacerMovedAndDeleted: true,
      projectSavedAndRestored: true,
      seamCroppingAndLiveSize: true,
      keepGuidesAndBackgroundExport: true,
      exportCancellationWithoutDownload: true,
      previewCancellationStoppedAt: previewsAtCancellation,
      previewInteractionResponsive: true,
      performance: {
        firstPreviewMs,
        fullPreviewMs,
        exportMs,
        previewHeapMb,
        previewRssMb,
        repeatedOpenHeapMb,
        repeatedOpenRssMb,
      },
      unsafeColumnDeleteBlocked: true,
      guideDetectionMatchesLegacy: true,
      cropTogglePreservedLayout: true,
      detectedGuides,
      croppedContent,
      svgExport,
      pageDimensions: pageDimensionsBefore,
      pageErrors,
    }),
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
