import { Pdf2PltError } from "../pdf/errors";
import type { LayoutCell, LayoutGrid } from "./automatic-layout";

const BLANK_TOKENS = new Set(["-", "_", "0", "x", "X"]);

export function parsePageLayout(
  expression: string,
  pageCount: number,
  allowUnusedPages = false,
): LayoutGrid {
  const rawColumns = expression.split("|");
  if (rawColumns.length === 0 || rawColumns.some((column) => !column.trim())) {
    throw new Pdf2PltError(
      "invalid-page-layout",
      "手动布局的每一列都必须有内容；空位请使用 -，列之间使用 |。",
    );
  }
  const columns: LayoutCell[][] = [];
  const seen = new Map<number, { column: number; row: number }>();
  let spacerNumber = 1;

  for (let columnIndex = 0; columnIndex < rawColumns.length; columnIndex += 1) {
    const rawColumn = rawColumns[columnIndex] ?? "";
    const tokens = rawColumn.trim().split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0) {
      throw new Pdf2PltError("invalid-page-layout", `手动布局的第 ${columnIndex + 1} 列为空。`);
    }
    const column: LayoutCell[] = [];
    for (const token of tokens) {
      if (BLANK_TOKENS.has(token)) {
        column.push({ kind: "spacer", spacerId: `manual-spacer-${spacerNumber}` });
        spacerNumber += 1;
        continue;
      }
      const range = token.match(/^(\d+)-(\d+)$/);
      let pageNumbers: number[];
      if (range) {
        const first = Number(range[1]);
        const last = Number(range[2]);
        const step = first <= last ? 1 : -1;
        pageNumbers = [];
        for (let page = first; page !== last + step; page += step) pageNumbers.push(page);
      } else {
        if (token.includes("-") || !/^\d+$/.test(token)) {
          throw new Pdf2PltError(
            "invalid-page-layout",
            `范围表达式 ${JSON.stringify(token)} 无效；请使用 1-5 这样的格式。`,
          );
        }
        pageNumbers = [Number(token)];
      }
      for (const pageNumber of pageNumbers) {
        if (pageNumber < 1 || pageNumber > pageCount) {
          throw new Pdf2PltError(
            "invalid-page-layout",
            `页码 ${pageNumber} 超出 PDF 页码范围 1..${pageCount}。`,
          );
        }
        const previous = seen.get(pageNumber);
        if (previous) {
          throw new Pdf2PltError(
            "invalid-page-layout",
            `页码 ${pageNumber} 重复：第 ${previous.column} 列第 ${previous.row} 格和第 ${columnIndex + 1} 列第 ${column.length + 1} 格。`,
          );
        }
        seen.set(pageNumber, { column: columnIndex + 1, row: column.length + 1 });
        column.push({ kind: "page", pageNumber });
      }
    }
    columns.push(column);
  }

  if (seen.size === 0) {
    throw new Pdf2PltError("invalid-page-layout", "手动布局至少需要包含一个 PDF 页码。");
  }
  const missing = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (page) => !seen.has(page),
  );
  if (missing.length > 0 && !allowUnusedPages) {
    throw new Pdf2PltError(
      "unused-pages",
      `手动布局遗漏 PDF 页码：${missing.join(",")}；若有意忽略，请添加 --allow-unused-pages。`,
    );
  }
  const rows = Math.max(...columns.map((column) => column.length));
  return {
    rows,
    columns: columns.length,
    traversal: "column-major",
    cells: Array.from({ length: rows }, (_, row) =>
      columns.map((column) => column[row] ?? null),
    ),
  };
}
