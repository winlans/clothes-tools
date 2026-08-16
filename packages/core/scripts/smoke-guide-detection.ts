import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import mupdf from "mupdf";

import { GUIDE_DIRECTIONS, openMuPdfDocument, type GuideCoordinates } from "../src/index";

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error("用法: pnpm smoke:guides <input.pdf> [more.pdf]");
  process.exit(2);
}

const legacyExpected: Record<string, GuideCoordinates> = {
  "ku小红叶528-4XL-A3.pdf": {
    left: 21.997,
    right: 818.893,
    top: 21.992,
    bottom: 1166.56,
  },
  "小红叶639-1合身T-4XL-A3.pdf": {
    left: 13.994,
    right: 1175.526,
    top: 13.999,
    bottom: 826.921,
  },
};

for (const input of inputs) {
  const inputPath = resolve(input);
  const document = await openMuPdfDocument(mupdf, new Uint8Array(await readFile(inputPath)));
  try {
    const detection = document.detectGuides();
    const expected = legacyExpected[basename(inputPath)];
    const differences: Partial<Record<keyof GuideCoordinates, number>> = {};
    if (expected) {
      for (const direction of GUIDE_DIRECTIONS) {
        const actual = detection.lines[direction]?.coordinatePt;
        if (actual === undefined) throw new Error(`${basename(inputPath)} 缺少 ${direction} 红线`);
        differences[direction] = actual - expected[direction];
        if (Math.abs(differences[direction] ?? Infinity) > 1) {
          throw new Error(
            `${basename(inputPath)} ${direction} 与旧工具偏差超过 1pt：${actual} vs ${expected[direction]}`,
          );
        }
      }
    }
    console.log(
      JSON.stringify({
        input: inputPath,
        lines: detection.lines,
        missing: detection.missing,
        inferredLayout: detection.inferredLayout,
        contentOverlap: detection.contentOverlap,
        differences,
      }),
    );
  } finally {
    document.close();
  }
}
