import { describe, expect, it } from "vitest";

import { createAutomaticLayout, getLayoutPageNumbers } from "./automatic-layout";

describe("createAutomaticLayout", () => {
  it("lays 15 pages out as five column-major columns of three", () => {
    const layout = createAutomaticLayout(15, 3);

    expect(layout.rows).toBe(3);
    expect(layout.columns).toBe(5);
    expect(layout.traversal).toBe("column-major");
    expect(getLayoutPageNumbers(layout)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
      [10, 11, 12],
      [13, 14, 15],
    ]);
  });

  it("leaves unused cells empty in the final column", () => {
    const layout = createAutomaticLayout(8, 3);

    expect(layout.columns).toBe(3);
    expect(layout.cells[2]?.[2]).toBeNull();
    expect(getLayoutPageNumbers(layout)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8]]);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid pages-per-column value %s",
    (value) => {
      expect(() => createAutomaticLayout(15, value)).toThrow(/每列页数必须是正整数/);
    },
  );
});
