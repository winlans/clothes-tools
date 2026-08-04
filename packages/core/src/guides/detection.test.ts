import { describe, expect, it } from "vitest";

import {
  DEFAULT_GUIDE_DETECTION_OPTIONS,
  buildGuideDetectionResult,
  clusterGuideSamples,
  detectRedGuides,
  inferPagesPerColumnFromGuideSamples,
  type GuidePixelPage,
  type GuideSample,
} from "./detection";

function makePage(directions: Array<"left" | "right" | "top" | "bottom">): GuidePixelPage {
  const width = 100;
  const height = 120;
  const components = 3;
  const pixels = new Uint8Array(width * height * components).fill(255);
  const paint = (x: number, y: number) => {
    const offset = (y * width + x) * components;
    pixels[offset] = 255;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
  };
  if (directions.includes("left")) {
    for (let y = 0; y < height; y += 1) paint(10, y);
  }
  if (directions.includes("right")) {
    for (let y = 0; y < height; y += 1) paint(90, y);
  }
  if (directions.includes("top")) {
    for (let x = 0; x < width; x += 1) paint(x, 15);
  }
  if (directions.includes("bottom")) {
    for (let x = 0; x < width; x += 1) paint(x, 105);
  }
  return { pageNumber: 1, width, height, stride: width * components, components, pixels };
}

describe("red guide detection", () => {
  it("keeps the legacy CLI defaults", () => {
    expect(DEFAULT_GUIDE_DETECTION_OPTIONS).toEqual({
      dpi: 72,
      redMin: 200,
      otherMax: 120,
      redDelta: 80,
      minimumFraction: 0.03,
    });
  });

  it("detects four red lines in point coordinates", () => {
    const result = detectRedGuides(
      [makePage(["left", "right", "top", "bottom"])],
      { width: 200, height: 240 },
    );

    expect(result.missing).toEqual([]);
    expect(result.lines.left).toMatchObject({ coordinatePt: 20, source: "auto" });
    expect(result.lines.right).toMatchObject({ coordinatePt: 180, source: "auto" });
    expect(result.lines.top).toMatchObject({ coordinatePt: 30, source: "auto" });
    expect(result.lines.bottom).toMatchObject({ coordinatePt: 210, source: "auto" });
  });

  it("reports missing directions so the UI can request manual values", () => {
    const result = detectRedGuides([makePage(["left"])], { width: 200, height: 240 });

    expect(result.lines.left?.coordinatePt).toBe(20);
    expect(result.missing).toEqual(["right", "top", "bottom"]);
  });

  it("prefers page support, then pixel weight, when clustering", () => {
    const line = clusterGuideSamples(
      [
        { pageNumber: 1, positionPt: 10, pixelWeight: 20 },
        { pageNumber: 2, positionPt: 10.2, pixelWeight: 30 },
        { pageNumber: 3, positionPt: 50, pixelWeight: 500 },
      ],
      0.5,
    );

    expect(line).toMatchObject({ coordinatePt: 10.2, supportPages: 2, pixelWeight: 50 });
  });

  it("infers column height from the first left guide and row boundaries", () => {
    const samples = [
      pageSamples(1, ["right", "bottom"]),
      pageSamples(2, ["right", "top", "bottom"]),
      pageSamples(3, ["right", "top"]),
      pageSamples(4, ["left", "right", "bottom"]),
      pageSamples(5, ["left", "right", "top", "bottom"]),
      pageSamples(6, ["left", "right", "top"]),
    ];

    expect(inferPagesPerColumnFromGuideSamples(samples)).toBe(3);
    expect(buildGuideDetectionResult(
      samples,
      { width: 200, height: 240 },
      DEFAULT_GUIDE_DETECTION_OPTIONS,
    ).inferredPagesPerColumn).toBe(3);
    expect(inferPagesPerColumnFromGuideSamples([
      pageSamples(1, ["right", "top", "bottom"]),
      pageSamples(2, ["right", "top", "bottom"]),
      pageSamples(3, ["right", "top", "bottom"]),
      pageSamples(4, ["right", "top"]),
      pageSamples(5, ["left", "top", "bottom"]),
      pageSamples(6, ["left", "top", "bottom"]),
      pageSamples(7, ["left", "top", "bottom"]),
      pageSamples(8, ["left", "top"]),
    ])).toBe(4);
  });

  it("rejects incomplete or contradictory column markers", () => {
    expect(inferPagesPerColumnFromGuideSamples([
      pageSamples(1, ["right", "bottom"]),
      pageSamples(2, ["right", "top", "bottom"]),
      pageSamples(3, ["right", "top"]),
      pageSamples(4, ["right", "bottom"]),
    ])).toBeUndefined();
    expect(inferPagesPerColumnFromGuideSamples([
      pageSamples(1, ["right", "bottom"]),
      pageSamples(2, ["right", "top", "bottom"]),
      pageSamples(3, ["right", "top", "bottom"]),
      pageSamples(4, ["left", "bottom"]),
    ])).toBeUndefined();
  });
});

function pageSamples(
  pageNumber: number,
  directions: Array<"left" | "right" | "top" | "bottom">,
): Partial<Record<"left" | "right" | "top" | "bottom", GuideSample>> {
  return Object.fromEntries(directions.map((direction) => [
    direction,
    { pageNumber, positionPt: 10, pixelWeight: 100 },
  ]));
}
