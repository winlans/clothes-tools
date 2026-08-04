import { describe, expect, it } from "vitest";

import {
  DEFAULT_GUIDE_DETECTION_OPTIONS,
  clusterGuideSamples,
  detectRedGuides,
  type GuidePixelPage,
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
});
