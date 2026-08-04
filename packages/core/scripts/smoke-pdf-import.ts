import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import mupdf from "mupdf";

import { openMuPdfDocument } from "../src/index";

const input = process.argv[2];
if (!input) {
  console.error("用法: pnpm smoke:pdf <input.pdf>");
  process.exit(2);
}

const inputPath = resolve(input);
const bytes = new Uint8Array(await readFile(inputPath));
const document = await openMuPdfDocument(mupdf, bytes);

try {
  const first = document.renderPreview(1, { maxLongEdge: 800 });
  const last = document.renderPreview(document.info.pageCount, { maxLongEdge: 800 });
  console.log(
    JSON.stringify(
      {
        input: inputPath,
        pageCount: document.info.pageCount,
        pageSizePt: document.info.pageSizePt,
        firstPreview: {
          width: first.width,
          height: first.height,
          bytes: first.bytes.byteLength,
        },
        lastPreview: {
          width: last.width,
          height: last.height,
          bytes: last.bytes.byteLength,
        },
      },
      null,
      2,
    ),
  );
} finally {
  document.close();
}
