import { describe, expect, it } from "vitest";

import {
  DEFAULT_GUIDE_DETECTION_OPTIONS,
  buildGuideDetectionResult,
  clusterGuideSamples,
  detectPatternGuides,
  detectRedGuides,
  inferColumnLayoutFromGuideSamples,
  inferPagesPerColumnFromGuideSamples,
  removeGuidePixelsAtCoordinates,
  removeRedGuidePixels,
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

function makePatternPage(
  pageNumber: number,
  directions: Array<"left" | "right" | "top" | "bottom">,
): GuidePixelPage {
  const width = 100;
  const height = 120;
  const components = 3;
  const pixels = new Uint8Array(width * height * components).fill(255);
  const paint = (x: number, y: number, color: [number, number, number]) => {
    const offset = (y * width + x) * components;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
  };
  const blue: [number, number, number] = [40, 40, 255];
  const dashed = (length: number, callback: (position: number) => void) => {
    for (let position = 0; position < length; position += 1) {
      if (position % 10 < 6) callback(position);
    }
  };
  if (directions.includes("left")) dashed(height, (y) => paint(10, y, blue));
  if (directions.includes("right")) dashed(height, (y) => paint(90, y, blue));
  if (directions.includes("top")) dashed(width, (x) => paint(x, 15, blue));
  if (directions.includes("bottom")) dashed(width, (x) => paint(x, 105, blue));

  // A longer ordinary black line on a minority of pages must not replace the
  // repeated edge-frame pattern merely because it has more pixels.
  if (pageNumber === 2 || pageNumber === 5) {
    for (let x = 0; x < width; x += 1) paint(x, 20, [0, 0, 0]);
  }
  return {
    pageNumber,
    width,
    height,
    stride: width * components,
    components,
    pixels,
  };
}

describe("red guide detection", () => {
  it("removes solid and antialiased red guide pixels from previews", () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0,
      255, 252, 252,
      20, 20, 20,
      255, 180, 40,
      255, 252, 252,
      20, 20, 20,
    ]);
    const removed = removeRedGuidePixels(
      { pageNumber: 1, width: 6, height: 1, stride: 18, components: 3, pixels },
      DEFAULT_GUIDE_DETECTION_OPTIONS,
    );

    expect(removed).toBe(2);
    expect([...pixels]).toEqual([
      255, 255, 255,
      255, 255, 255,
      20, 20, 20,
      255, 180, 40,
      255, 252, 252,
      20, 20, 20,
    ]);
  });

  it("removes a detected non-red guide only at its page coordinate", () => {
    const width = 10;
    const height = 8;
    const pixels = new Uint8ClampedArray(width * height * 3).fill(255);
    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + 2) * 3;
      pixels[offset] = 40;
      pixels[offset + 1] = 40;
      pixels[offset + 2] = 255;
    }
    for (let x = 0; x < width; x += 1) {
      const offset = (2 * width + x) * 3;
      pixels[offset] = 40;
      pixels[offset + 1] = 40;
      pixels[offset + 2] = 255;
    }
    pixels[0] = 40;
    pixels[1] = 40;
    pixels[2] = 255;
    const artworkOffset = (4 * width + 6) * 3;
    pixels[artworkOffset] = 0;
    pixels[artworkOffset + 1] = 0;
    pixels[artworkOffset + 2] = 0;
    const edgeArtworkOffset = 6 * 3;
    pixels[edgeArtworkOffset] = 0;
    pixels[edgeArtworkOffset + 1] = 0;
    pixels[edgeArtworkOffset + 2] = 0;

    const removed = removeGuidePixelsAtCoordinates(
      { pageNumber: 1, width, height, stride: width * 3, components: 3, pixels },
      { width: 20, height: 16 },
      { left: 4, right: 18, top: 4, bottom: 14 },
    );

    expect(removed).toBeGreaterThanOrEqual(height);
    expect([...pixels.slice((4 * width + 2) * 3, (4 * width + 2) * 3 + 3)])
      .toEqual([255, 255, 255]);
    expect([...pixels.slice(artworkOffset, artworkOffset + 3)]).toEqual([0, 0, 0]);
    expect([...pixels.slice(0, 3)]).toEqual([255, 255, 255]);
    expect([...pixels.slice(edgeArtworkOffset, edgeArtworkOffset + 3)]).toEqual([0, 0, 0]);
  });

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

  it("detects a repeated edge-frame pattern without depending on its colour", () => {
    const directions = [
      ["right", "bottom"],
      ["right", "top", "bottom"],
      ["right", "top"],
      ["left", "right", "bottom"],
      ["left", "right", "top", "bottom"],
      ["left", "right", "top"],
    ] as const;
    const result = detectPatternGuides(
      directions.map((pageDirections, index) =>
        makePatternPage(index + 1, [...pageDirections])
      ),
      { width: 200, height: 240 },
      DEFAULT_GUIDE_DETECTION_OPTIONS,
    );

    expect(result.lines).toMatchObject({
      left: { coordinatePt: 20 },
      right: { coordinatePt: 180 },
      top: { coordinatePt: 30 },
      bottom: { coordinatePt: 210 },
    });
    expect(result.inferredLayout).toEqual({
      pagesPerColumn: 3,
      columns: [
        [1, 2, 3],
        [4, 5, 6],
      ],
    });
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

  it("infers a bottom-aligned short column from the 530 guide pattern", () => {
    const samples = [
      pageSamples(1, ["right", "bottom"]),
      pageSamples(2, ["right", "top", "bottom"]),
      pageSamples(3, ["right", "top", "bottom"]),
      pageSamples(4, ["right", "top", "bottom"]),
      pageSamples(5, ["right", "top"]),
      pageSamples(6, ["left", "right", "top", "bottom"]),
      pageSamples(7, ["left", "right", "top", "bottom"]),
      pageSamples(8, ["left", "right", "top", "bottom"]),
      pageSamples(9, ["left", "right", "top"]),
      pageSamples(10, ["left", "bottom"]),
      pageSamples(11, ["left", "top", "bottom"]),
      pageSamples(12, ["left", "top", "bottom"]),
      pageSamples(13, ["left", "top", "bottom"]),
      pageSamples(14, ["left", "top"]),
    ];

    expect(inferColumnLayoutFromGuideSamples(samples)).toEqual({
      pagesPerColumn: 5,
      columns: [
        [1, 2, 3, 4, 5],
        [null, 6, 7, 8, 9],
        [10, 11, 12, 13, 14],
      ],
    });
    expect(inferPagesPerColumnFromGuideSamples(samples)).toBe(5);
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
