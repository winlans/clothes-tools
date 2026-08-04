import { describe, expect, it } from "vitest";

import { flattenLayout } from "./reorder";
import { parsePageLayout } from "./manual-layout";

describe("manual page layout", () => {
  it("expands ascending and descending ranges and pads uneven columns", () => {
    const layout = parsePageLayout("1-3|6-4|7,8", 8);
    expect(layout).toMatchObject({ rows: 3, columns: 3 });
    expect(
      layout.cells.map((row) => row.map((cell) => cell?.kind === "page" ? cell.pageNumber : null)),
    ).toEqual([[1, 6, 7], [2, 5, 8], [3, 4, null]]);
  });

  it("keeps explicit blanks distinct from rectangular padding", () => {
    const layout = parsePageLayout("1,-,2|3", 3);
    expect(flattenLayout(layout).map((cell) => cell?.kind ?? null)).toEqual([
      "page", "spacer", "page", "page", null, null,
    ]);
  });

  it("rejects duplicate, out-of-range, and missing pages by default", () => {
    expect(() => parsePageLayout("1,2|2,3", 3)).toThrow(/重复/);
    expect(() => parsePageLayout("1,4|2,3", 3)).toThrow(/范围/);
    expect(() => parsePageLayout("1|3", 3)).toThrow(/遗漏/);
    expect(() => parsePageLayout("1|3", 3, true)).not.toThrow();
  });
});
