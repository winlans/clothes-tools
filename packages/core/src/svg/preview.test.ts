import { describe, expect, it } from "vitest";

import { prepareSvgPreview } from "./preview";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">
  <path id="hex-guide" stroke="#ff0000" d="M0 0V300"/>
  <path id="style-guide" style="fill:none;stroke:rgb(92%, 5%, 5%)" d="M10 0V300"/>
  <path id="blue-coordinate-guide" transform="matrix(.1 0 0 .1 0 0)" fill="none" stroke="#0000ff" d="M200 0V3000"/>
  <path id="blue-corner-guide" fill="none" stroke="#0000ff" d="M0 0H10"/>
  <path id="blue-artwork" fill="none" stroke="#0000ff" d="M80 0V300"/>
  <path id="ink" stroke="#202020" d="M20 0V300"/>
  <text id="label" fill="#202020">A</text>
</svg>`;

describe("SVG preview preparation", () => {
  it("removes vector guide elements using the configured red thresholds", () => {
    const prepared = prepareSvgPreview(svg, {
      removeGuides: true,
      guideDetection: {
        dpi: 72,
        redMin: 200,
        otherMax: 120,
        redDelta: 80,
        minimumFraction: 0.03,
      },
    });

    expect(prepared).not.toContain("hex-guide");
    expect(prepared).not.toContain("style-guide");
    expect(prepared).toContain("ink");
    expect(prepared).toContain("label");
  });

  it("keeps the original vector document when guide removal is disabled", () => {
    expect(prepareSvgPreview(svg, { removeGuides: false })).toBe(svg);
  });

  it("removes a non-red vector guide by its detected coordinate", () => {
    const prepared = prepareSvgPreview(svg, {
      removeGuides: true,
      guides: { left: 20, right: 180, top: 30, bottom: 270 },
    });

    expect(prepared).not.toContain("blue-coordinate-guide");
    expect(prepared).not.toContain("blue-corner-guide");
    expect(prepared).toContain("blue-artwork");
  });

  it("rejects malformed SVG output", () => {
    expect(() => prepareSvgPreview("<path/>", { removeGuides: true }))
      .toThrow("MuPDF 页面没有生成有效的 SVG");
  });
});
