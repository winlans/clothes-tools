import { describe, expect, it } from "vitest";

import type { SvgExportResult } from "../svg/exporter";
import { buildCorelPlt } from "./exporter";

function svgResult(body: string, widthPt = 72, heightPt = 72): SvgExportResult {
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPt} ${heightPt}">${body}</svg>`,
    widthPt,
    heightPt,
    pageInstances: 1,
    visibleObjects: 1,
  };
}

describe("CorelDRAW PLT exporter", () => {
  it("writes absolute HP-GL in 1016 units per inch with a lower-left origin", () => {
    const result = buildCorelPlt(
      svgResult('<path d="M0 0L72 72" fill="none" stroke="black"/>'),
    );

    expect(result.plt).toBe("IN;\nSP1;\nPA;\nPU0,1016;\nPD1016,0;\nPU;\nSP0;\n");
    expect(result.paths).toBe(1);
    expect(result.segments).toBe(1);
  });

  it("resolves glyph-style use references and inherited transforms", () => {
    const result = buildCorelPlt(
      svgResult(`
        <defs><path id="glyph" d="M0 0L10 0L10 10Z"/></defs>
        <g transform="translate(10 20)"><use href="#glyph" fill="none" stroke="black"/></g>
      `),
    );

    expect(result.paths).toBe(1);
    expect(result.plt).toContain("PU141,734;");
    expect(result.plt).toContain("PD282,734,282,593,141,734;");
  });

  it("supports nested negative SVG transforms", () => {
    const result = buildCorelPlt(
      svgResult(`
        <g transform="translate(72 0) scale(-1 1)">
          <path d="M0 0L18 0" fill="none" stroke="black"/>
        </g>
      `),
    );

    expect(result.plt).toContain("PU1016,1016;");
    expect(result.plt).toContain("PD762,1016;");
  });

  it("clips output paths to the combined layout crop", () => {
    const result = buildCorelPlt(
      svgResult(`
        <defs><clipPath id="tile"><rect x="0" y="0" width="72" height="72"/></clipPath></defs>
        <path clip-path="url(#tile)" d="M-10 36H82" fill="none" stroke="black"/>
      `),
    );

    expect(result.plt).toContain("PU0,508;");
    expect(result.plt).toContain("PD1016,508;");
  });

  it("flattens curves according to the physical tolerance", () => {
    const coarse = buildCorelPlt(
      svgResult('<path d="M0 72C0 0 72 0 72 72" fill="none" stroke="black"/>'),
      { curveToleranceMm: 1 },
    );
    const fine = buildCorelPlt(
      svgResult('<path d="M0 72C0 0 72 0 72 72" fill="none" stroke="black"/>'),
      { curveToleranceMm: 0.01 },
    );

    expect(coarse.segments).toBeGreaterThan(1);
    expect(fine.segments).toBeGreaterThan(coarse.segments);
  });

  it("expands dashed strokes and reports omitted bitmap images", () => {
    const result = buildCorelPlt(
      svgResult(`
        <path d="M0 10H72" fill="none" stroke="black" stroke-dasharray="8 4"/>
        <image href="data:image/png;base64,AA==" x="0" y="0" width="10" height="10"/>
      `),
    );

    expect(result.paths).toBeGreaterThan(1);
    expect(result.omittedImages).toBe(1);
    expect(result.warnings).toContain("PLT 仅包含矢量轮廓，位图图像已跳过。");
  });
});
