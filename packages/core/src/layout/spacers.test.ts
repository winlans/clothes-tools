import { describe, expect, it } from "vitest";

import { createAutomaticLayout } from "./automatic-layout";
import {
  addLayoutColumn,
  addLayoutRow,
  flattenLayout,
  insertLayoutSpacer,
  moveLayoutSpacer,
  removeLastLayoutColumn,
  removeLastLayoutRow,
  removeLayoutSpacer,
} from "./reorder";

const pages = (layout: ReturnType<typeof createAutomaticLayout>) =>
  flattenLayout(layout).flatMap((cell) =>
    cell?.kind === "page" ? [cell.pageNumber] : [],
  );

describe("layout spacers", () => {
  it("distinguishes a spacer from an unused cell and reuses spare capacity", () => {
    const inserted = insertLayoutSpacer(createAutomaticLayout(5, 3), "s1", {
      row: 1,
      column: 0,
    });

    expect(inserted.columns).toBe(2);
    expect(flattenLayout(inserted)[1]).toEqual({ kind: "spacer", spacerId: "s1" });
    expect(flattenLayout(inserted)).not.toContain(null);
    expect(pages(inserted)).toEqual([1, 2, 3, 4, 5]);
  });

  it("expands a full layout and moves or deletes spacers without changing pages", () => {
    const initial = createAutomaticLayout(6, 3);
    const inserted = insertLayoutSpacer(initial, "s1", { row: 0, column: 0 });
    const moved = moveLayoutSpacer(inserted, "s1", { row: 2, column: 2 });
    const removed = removeLayoutSpacer(moved, "s1");

    expect(inserted).toMatchObject({ rows: 3, columns: 3 });
    expect(flattenLayout(moved)[8]).toEqual({ kind: "spacer", spacerId: "s1" });
    expect(pages(removed)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("adds dimensions but blocks deletion while the edge contains content", () => {
    const layout = createAutomaticLayout(6, 3);
    expect(() => removeLastLayoutRow(layout)).toThrow(/仍有页面或空白块/);
    expect(() => removeLastLayoutColumn(layout)).toThrow(/仍有页面或空白块/);

    const withRow = addLayoutRow(layout);
    const withColumn = addLayoutColumn(layout);
    expect(removeLastLayoutRow(withRow)).toEqual(layout);
    expect(removeLastLayoutColumn(withColumn)).toEqual(layout);
  });
});
