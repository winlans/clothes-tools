import { describe, expect, it } from "vitest";

import { createAutomaticLayout, type LayoutGrid } from "../layout/automatic-layout";
import { buildCombinedSvg } from "./exporter";

const source = `<?xml version="1.0"?><svg width="200" height="300" viewBox="0 0 200 300">
<defs><clipPath id="clip_1"><path id="shape" d="M0 0H10V10Z"/></clipPath></defs>
<path id="red" stroke="#ff0000" d="M1 0V300"/>
<path id="paper" fill="#ffffff" d="M0 0H200V300Z"/>
<path id="ink" clip-path="url(#clip_1)" d="M2 2H8V8Z"/>
<use href="#shape"/>
</svg>`;

describe("combined SVG exporter", () => {
  it("builds one millimetre-sized root and rewrites page references", () => {
    const result = buildCombinedSvg(
      [
        { pageNumber: 1, svg: source },
        { pageNumber: 2, svg: source },
      ],
      createAutomaticLayout(2, 1),
      { width: 200, height: 300 },
      { left: 20, right: 180, top: 30, bottom: 270 },
    );

    expect(result.svg.match(/<svg\b/g)).toHaveLength(1);
    expect(result.svg).toContain('width="127.000000mm"');
    expect(result.svg).toContain('viewBox="0 0 360 300"');
    expect(result.svg).toContain('id="page1-cell0-0-clip_1"');
    expect(result.svg).toContain('clip-path="url(#page2-cell0-1-clip_1)"');
    expect(result.svg).toContain('href="#page2-cell0-1-shape"');
    expect(result.svg).not.toContain('id="clip_1"');
    expect(result.svg).not.toContain("#ff0000");
    expect(result.svg).not.toContain("#ffffff");
  });

  it("retains spacer dimensions without emitting a page instance", () => {
    const layout: LayoutGrid = {
      ...createAutomaticLayout(1, 1),
      columns: 2,
      cells: [[{ kind: "page", pageNumber: 1 }, { kind: "spacer", spacerId: "blank" }]],
    };
    const result = buildCombinedSvg(
      [{ pageNumber: 1, svg: source }],
      layout,
      { width: 200, height: 300 },
      undefined,
    );

    expect(result.widthPt).toBe(400);
    expect(result.pageInstances).toBe(1);
    expect(result.svg.match(/data-page=/g)).toHaveLength(1);
  });

  it("can preserve red guides and white backgrounds", () => {
    const result = buildCombinedSvg(
      [{ pageNumber: 1, svg: source }],
      createAutomaticLayout(1, 1),
      { width: 200, height: 300 },
      undefined,
      { removeGuides: false, removeBackground: false },
    );

    expect(result.svg).toContain("#ff0000");
    expect(result.svg).toContain("#ffffff");
  });
});
