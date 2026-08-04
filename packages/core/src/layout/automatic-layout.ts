import { Pdf2PltError } from "../pdf/errors";

export interface PageCell {
  kind: "page";
  pageNumber: number;
}

export interface SpacerCell {
  kind: "spacer";
  spacerId: string;
}

export type LayoutCell = PageCell | SpacerCell | null;

export interface LayoutGrid {
  rows: number;
  columns: number;
  traversal: "column-major";
  cells: LayoutCell[][];
}

function requirePositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Pdf2PltError("invalid-layout-size", `${label}必须是正整数。`);
  }
}

export function createAutomaticLayout(
  pageCount: number,
  pagesPerColumn: number,
): LayoutGrid {
  requirePositiveInteger(pageCount, "PDF 页数");
  requirePositiveInteger(pagesPerColumn, "每列页数");

  const rows = pagesPerColumn;
  const columns = Math.ceil(pageCount / rows);
  const cells: LayoutCell[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      const pageNumber = column * rows + row + 1;
      return pageNumber <= pageCount ? { kind: "page", pageNumber } : null;
    }),
  );

  return { rows, columns, traversal: "column-major", cells };
}

export function getLayoutPageNumbers(layout: LayoutGrid): number[][] {
  return Array.from({ length: layout.columns }, (_, column) =>
    Array.from({ length: layout.rows }, (_, row) => layout.cells[row]?.[column])
      .filter((cell): cell is PageCell => cell?.kind === "page")
      .map((cell) => cell.pageNumber),
  );
}
