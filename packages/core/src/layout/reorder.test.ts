import { describe, expect, it } from "vitest";

import { createAutomaticLayout, getLayoutPageNumbers } from "./automatic-layout";
import { flattenLayout, insertLayoutPage, moveLayoutPage } from "./reorder";

function pageSequence(layout: ReturnType<typeof createAutomaticLayout>) {
  return flattenLayout(layout).flatMap((cell) =>
    cell?.kind === "page" ? [cell.pageNumber] : [],
  );
}

describe("layout reordering", () => {
  it("moves a page forward to the exact target cell", () => {
    const moved = moveLayoutPage(createAutomaticLayout(6, 3), 2, {
      row: 1,
      column: 1,
    });

    expect(pageSequence(moved)).toEqual([1, 3, 4, 5, 2, 6]);
  });

  it("moves a page backward and preserves all page numbers", () => {
    const moved = moveLayoutPage(createAutomaticLayout(6, 3), 5, {
      row: 1,
      column: 0,
    });

    expect(pageSequence(moved)).toEqual([1, 5, 2, 3, 4, 6]);
    expect(new Set(pageSequence(moved)).size).toBe(6);
  });

  it("moves into an empty target without leaving the page between cells", () => {
    const moved = moveLayoutPage(createAutomaticLayout(8, 3), 2, {
      row: 2,
      column: 2,
    });

    expect(getLayoutPageNumbers(moved)).toEqual([[1, 3, 4], [5, 6, 7], [8, 2]]);
  });

  it("expands the right edge when an external insert overflows capacity", () => {
    const inserted = insertLayoutPage(createAutomaticLayout(6, 3), 7, {
      row: 1,
      column: 0,
    });

    expect(inserted).toMatchObject({ rows: 3, columns: 3 });
    expect(pageSequence(inserted)).toEqual([1, 7, 2, 3, 4, 5, 6]);
  });

  it("rejects duplicate pages and out-of-range targets", () => {
    const layout = createAutomaticLayout(6, 3);
    expect(() => insertLayoutPage(layout, 2, { row: 0, column: 0 })).toThrow(
      /已经在布局中/,
    );
    expect(() => moveLayoutPage(layout, 2, { row: 3, column: 0 })).toThrow(
      /超出布局范围/,
    );
  });
});
