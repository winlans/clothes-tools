import { Pdf2PltError } from "../pdf/errors";
import type { LayoutCell, LayoutGrid, PageCell } from "./automatic-layout";

export interface GridPosition {
  row: number;
  column: number;
}

export function getColumnMajorIndex(layout: LayoutGrid, position: GridPosition): number {
  if (
    !Number.isInteger(position.row) ||
    !Number.isInteger(position.column) ||
    position.row < 0 ||
    position.row >= layout.rows ||
    position.column < 0 ||
    position.column >= layout.columns
  ) {
    throw new Pdf2PltError(
      "invalid-grid-position",
      `目标格 (${position.row + 1}, ${position.column + 1}) 超出布局范围。`,
    );
  }
  return position.column * layout.rows + position.row;
}

export function flattenLayout(layout: LayoutGrid): LayoutCell[] {
  return Array.from(
    { length: layout.rows * layout.columns },
    (_, index) => {
      const row = index % layout.rows;
      const column = Math.floor(index / layout.rows);
      return layout.cells[row]?.[column] ?? null;
    },
  );
}

function rebuildLayout(
  rows: number,
  cells: LayoutCell[],
  minimumColumns: number,
): LayoutGrid {
  const columns = Math.max(minimumColumns, Math.ceil(cells.length / rows));
  const capacity = rows * columns;
  const padded = [...cells, ...Array<LayoutCell>(capacity - cells.length).fill(null)];

  return {
    rows,
    columns,
    traversal: "column-major",
    cells: Array.from({ length: rows }, (_, row) =>
      Array.from(
        { length: columns },
        (_, column) => padded[column * rows + row] ?? null,
      ),
    ),
  };
}

function findPageIndex(cells: readonly LayoutCell[], pageNumber: number): number {
  const index = cells.findIndex(
    (cell) => cell?.kind === "page" && cell.pageNumber === pageNumber,
  );
  if (index < 0) {
    throw new Pdf2PltError("page-not-in-layout", `布局中找不到第 ${pageNumber} 页。`);
  }
  return index;
}

export function moveLayoutPage(
  layout: LayoutGrid,
  pageNumber: number,
  target: GridPosition,
): LayoutGrid {
  const targetIndex = getColumnMajorIndex(layout, target);
  const cells = flattenLayout(layout);
  const sourceIndex = findPageIndex(cells, pageNumber);
  if (sourceIndex === targetIndex) return layout;

  const [moving] = cells.splice(sourceIndex, 1);
  if (!moving) {
    throw new Pdf2PltError("page-not-in-layout", `布局中找不到第 ${pageNumber} 页。`);
  }
  cells.splice(targetIndex, 0, moving);

  return rebuildLayout(layout.rows, cells, layout.columns);
}

export function insertLayoutPage(
  layout: LayoutGrid,
  pageNumber: number,
  target: GridPosition,
): LayoutGrid {
  if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
    throw new Pdf2PltError("invalid-page", "插入页码必须是正整数。");
  }
  const targetIndex = getColumnMajorIndex(layout, target);
  const cells = flattenLayout(layout);
  if (cells.some((cell) => cell?.kind === "page" && cell.pageNumber === pageNumber)) {
    throw new Pdf2PltError("duplicate-page", `第 ${pageNumber} 页已经在布局中。`);
  }

  const page: PageCell = { kind: "page", pageNumber };
  if (cells[targetIndex] === null) {
    cells[targetIndex] = page;
  } else {
    cells.splice(targetIndex, 0, page);
  }
  return rebuildLayout(layout.rows, cells, layout.columns);
}
