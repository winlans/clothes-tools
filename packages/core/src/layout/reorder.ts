import { Pdf2PltError } from "../pdf/errors";
import type {
  LayoutCell,
  LayoutGrid,
  PageCell,
  SpacerCell,
} from "./automatic-layout";

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

export function rebuildLayout(
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

function moveCellAtIndex(
  layout: LayoutGrid,
  sourceIndex: number,
  targetIndex: number,
): LayoutGrid {
  if (sourceIndex === targetIndex) return layout;
  const cells = flattenLayout(layout);
  const [moving] = cells.splice(sourceIndex, 1);
  if (!moving) {
    throw new Pdf2PltError("layout-cell-missing", "找不到要移动的布局成员。");
  }
  cells.splice(targetIndex, 0, moving);
  return rebuildLayout(layout.rows, cells, layout.columns);
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
  return moveCellAtIndex(layout, sourceIndex, targetIndex);
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

function findSpacerIndex(cells: readonly LayoutCell[], spacerId: string): number {
  const index = cells.findIndex(
    (cell) => cell?.kind === "spacer" && cell.spacerId === spacerId,
  );
  if (index < 0) {
    throw new Pdf2PltError("spacer-not-in-layout", "布局中找不到该空白块。");
  }
  return index;
}

export function insertLayoutSpacer(
  layout: LayoutGrid,
  spacerId: string,
  target: GridPosition,
): LayoutGrid {
  if (!spacerId) {
    throw new Pdf2PltError("invalid-spacer", "空白块标识不能为空。");
  }
  const targetIndex = getColumnMajorIndex(layout, target);
  const cells = flattenLayout(layout);
  if (cells.some((cell) => cell?.kind === "spacer" && cell.spacerId === spacerId)) {
    throw new Pdf2PltError("duplicate-spacer", "该空白块已经在布局中。");
  }

  const spacer: SpacerCell = { kind: "spacer", spacerId };
  cells.splice(targetIndex, 0, spacer);
  let reusableNull = -1;
  for (let index = cells.length - 1; index > targetIndex; index -= 1) {
    if (cells[index] === null) {
      reusableNull = index;
      break;
    }
  }
  if (reusableNull >= 0) cells.splice(reusableNull, 1);
  return rebuildLayout(layout.rows, cells, layout.columns);
}

export function moveLayoutSpacer(
  layout: LayoutGrid,
  spacerId: string,
  target: GridPosition,
): LayoutGrid {
  const targetIndex = getColumnMajorIndex(layout, target);
  const sourceIndex = findSpacerIndex(flattenLayout(layout), spacerId);
  return moveCellAtIndex(layout, sourceIndex, targetIndex);
}

export function removeLayoutSpacer(layout: LayoutGrid, spacerId: string): LayoutGrid {
  const cells = flattenLayout(layout);
  const sourceIndex = findSpacerIndex(cells, spacerId);
  cells.splice(sourceIndex, 1);
  cells.push(null);
  return rebuildLayout(layout.rows, cells, layout.columns);
}

export function addLayoutRow(layout: LayoutGrid): LayoutGrid {
  return {
    ...layout,
    rows: layout.rows + 1,
    cells: [...layout.cells, Array<LayoutCell>(layout.columns).fill(null)],
  };
}

export function removeLastLayoutRow(layout: LayoutGrid): LayoutGrid {
  if (layout.rows <= 1) {
    throw new Pdf2PltError("minimum-layout-size", "布局至少需要保留一行。");
  }
  const lastRow = layout.cells[layout.rows - 1];
  if (lastRow?.some((cell) => cell !== null)) {
    throw new Pdf2PltError("row-not-empty", "最后一行仍有页面或空白块，不能删除。");
  }
  return { ...layout, rows: layout.rows - 1, cells: layout.cells.slice(0, -1) };
}

export function addLayoutColumn(layout: LayoutGrid): LayoutGrid {
  return {
    ...layout,
    columns: layout.columns + 1,
    cells: layout.cells.map((row) => [...row, null]),
  };
}

export function removeLastLayoutColumn(layout: LayoutGrid): LayoutGrid {
  if (layout.columns <= 1) {
    throw new Pdf2PltError("minimum-layout-size", "布局至少需要保留一列。");
  }
  if (layout.cells.some((row) => row[layout.columns - 1] !== null)) {
    throw new Pdf2PltError("column-not-empty", "最后一列仍有页面或空白块，不能删除。");
  }
  return {
    ...layout,
    columns: layout.columns - 1,
    cells: layout.cells.map((row) => row.slice(0, -1)),
  };
}
