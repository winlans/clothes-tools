import { describe, expect, it } from "vitest";

import {
  detailPreviewLongEdge,
  visibleDetailPreviewPages,
} from "./detail-preview";

describe("detail preview scheduling", () => {
  it("uses bounded resolution tiers based on actual display pixels", () => {
    const page = { width: 842, height: 1190 };
    expect(detailPreviewLongEdge(page, 0.5, 2)).toBeUndefined();
    expect(detailPreviewLongEdge(page, 0.8, 2)).toBe(2400);
    expect(detailPreviewLongEdge(page, 1.2, 2)).toBe(3200);
    expect(detailPreviewLongEdge(page, 4, 2)).toBe(4096);
  });

  it("requests only page frames intersecting the current canvas viewport", () => {
    const pages = [
      { pageNumber: 1, x: 0, y: 0, width: 200, height: 300 },
      { pageNumber: 2, x: 200, y: 0, width: 200, height: 300 },
      { pageNumber: 3, x: 400, y: 0, width: 200, height: 300 },
    ];
    expect(visibleDetailPreviewPages(
      { x: -210, y: 0, scale: 1 },
      { width: 180, height: 250 },
      { width: 600, height: 300 },
      0,
      pages,
      0,
    )).toEqual([2]);
    expect(visibleDetailPreviewPages(
      { x: 0, y: 0, scale: 1 },
      { width: 250, height: 350 },
      { width: 600, height: 300 },
      90,
      pages,
      0,
    )).toEqual([1, 2]);
  });
});
