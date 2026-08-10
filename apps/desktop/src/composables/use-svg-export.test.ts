import { describe, expect, it } from "vitest";

import {
  defaultExportName,
  defaultSvgName,
  normalizeExportName,
  normalizeSvgName,
} from "./use-svg-export";

describe("SVG export file names", () => {
  it("derives a default SVG name from the PDF name", () => {
    expect(defaultSvgName("版图.PDF")).toBe("版图.svg");
    expect(defaultSvgName("版图")).toBe("版图.svg");
  });

  it("keeps a custom name and adds the SVG extension", () => {
    expect(normalizeSvgName("  新名称  ", "原文件.pdf")).toBe("新名称.svg");
    expect(normalizeSvgName("新名称.SVG", "原文件.pdf")).toBe("新名称.SVG");
  });

  it("falls back to the PDF name and removes invalid path characters", () => {
    expect(normalizeSvgName("   ", "原文件.pdf")).toBe("原文件.svg");
    expect(normalizeSvgName("客户/A:01", "原文件.pdf")).toBe("客户_A_01.svg");
  });

  it("derives and normalizes CorelDRAW PLT names", () => {
    expect(defaultExportName("版图.PDF", "plt")).toBe("版图.plt");
    expect(normalizeExportName("客户/A:01", "原文件.pdf", "plt"))
      .toBe("客户_A_01.plt");
    expect(normalizeExportName("旧名称.svg", "原文件.pdf", "plt"))
      .toBe("旧名称.plt");
  });
});
