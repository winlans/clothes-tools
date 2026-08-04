import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import mupdf from "mupdf";

import { buildCombinedSvg, createAutomaticLayout, GUIDE_DIRECTIONS, openMuPdfDocument } from "../src/index";

const [input, rowsText, output] = process.argv.slice(2);
if (!input || !rowsText || !output) {
  console.error("用法: pnpm smoke:svg <input.pdf> <rows> <output.svg>");
  process.exit(2);
}
const rows = Number(rowsText);
const document = await openMuPdfDocument(
  mupdf,
  new Uint8Array(await readFile(resolve(input))),
);
try {
  const detection = document.detectGuides();
  const coordinates = Object.fromEntries(
    GUIDE_DIRECTIONS.map((direction) => [direction, detection.lines[direction]?.coordinatePt]),
  );
  if (Object.values(coordinates).some((value) => value === undefined)) {
    throw new Error(`缺少拼接线：${detection.missing.join(", ")}`);
  }
  const pages = Array.from({ length: document.info.pageCount }, (_, index) => ({
    pageNumber: index + 1,
    svg: document.renderSvgPage(index + 1),
  }));
  const result = buildCombinedSvg(
    pages,
    createAutomaticLayout(document.info.pageCount, rows),
    document.info.pageSizePt,
    coordinates as { left: number; right: number; top: number; bottom: number },
  );
  await writeFile(resolve(output), result.svg);
  console.log(JSON.stringify({ output: resolve(output), ...result, svg: undefined }));
} finally {
  document.close();
}
