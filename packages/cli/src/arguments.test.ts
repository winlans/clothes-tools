import { describe, expect, it } from "vitest";

import { parseCliArguments } from "./arguments";

describe("CLI argument parser", () => {
  it("supports automatic and manual layout aliases", () => {
    expect(parseCliArguments(["-i", "input.pdf", "-c", "3"])).toMatchObject({
      input: "input.pdf",
      pagesPerColumn: 3,
      guideMode: "auto",
    });
    expect(parseCliArguments(["--input=input.pdf", "--layout", "1-3|6-4"])).toMatchObject({
      input: "input.pdf",
      pageLayout: "1-3|6-4",
    });
  });

  it("parses every legacy guide, output, and ordering option", () => {
    const options = parseCliArguments([
      "-i", "input.pdf", "-c", "4", "--columns", "2", "--order", "row-major",
      "--column-order", "2,1", "--row-order", "4,3,2,1", "--guide-mode", "manual",
      "--seam-left", "14", "--seam-right", "1175", "--seam-top", "14",
      "--seam-bottom", "827", "--outer-left", "2", "--outer-right", "1188",
      "--outer-top", "3", "--outer-bottom", "840", "--guide-dpi", "96",
      "--red-min", "190", "--other-max", "110", "--red-delta", "70",
      "--guide-min-fraction", "0.04", "--keep-guides", "--keep-background",
      "--work-dir", "/tmp/work", "--rsvg-convert", "/tmp/rsvg", "--no-flatten",
      "--overwrite", "-o", "output.svg",
    ]);

    expect(options).toMatchObject({
      columns: 2,
      order: "row-major",
      guideMode: "manual",
      seamLeft: 14,
      outerBottom: 840,
      keepGuides: true,
      keepBackground: true,
      overwrite: true,
      output: "output.svg",
      detection: { dpi: 96, redMin: 190, otherMax: 110, redDelta: 70, minimumFraction: 0.04 },
    });
    expect(options.warnings).toHaveLength(3);
  });

  it("accepts project export and rejects ambiguous input", () => {
    expect(parseCliArguments(["--project", "layout.pattern-layout.json"])).toMatchObject({
      project: "layout.pattern-layout.json",
    });
    expect(() => parseCliArguments(["-i", "a.pdf", "-c", "3", "-p", "1-3"])).toThrow(/必须且只能/);
    expect(() => parseCliArguments(["-i", "a.pdf", "-c", "0"])).toThrow(/大于 0/);
    expect(() => parseCliArguments(["--unknown"])).toThrow(/未知参数/);
  });
});
