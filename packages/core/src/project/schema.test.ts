import { describe, expect, it } from "vitest";

import { createAutomaticLayout } from "../layout/automatic-layout";
import { DEFAULT_GUIDE_DETECTION_OPTIONS } from "../guides/detection";
import {
  parsePatternLayoutProject,
  createRelativeSourcePath,
  serializePatternLayoutProject,
  type PatternLayoutProjectV1,
} from "./schema";

function project(): PatternLayoutProjectV1 {
  return {
    schemaVersion: 1,
    source: {
      absolutePath: "/patterns/input.pdf",
      relativePath: "./input.pdf",
      sha256: "a".repeat(64),
      pageCount: 2,
      pageSizePt: { width: 200, height: 300 },
    },
    layout: createAutomaticLayout(2, 1),
    guides: {
      mode: "auto",
      seamLeft: 20,
      seamRight: 180,
      seamTop: 30,
      seamBottom: 270,
      outerLeft: 0,
      outerTop: 0,
      detection: { ...DEFAULT_GUIDE_DETECTION_OPTIONS },
    },
    output: { keepGuides: false, keepBackground: false, allowUnusedPages: false },
    view: { zoom: 0.75, panX: 12, panY: -8 },
  };
}

describe("pattern layout project schema", () => {
  it("round-trips with stable serialization", () => {
    const first = serializePatternLayoutProject(project());
    const second = serializePatternLayoutProject(parsePatternLayoutProject(first));
    expect(second).toBe(first);
    expect(first).toContain('"schemaVersion": 1');
  });

  it("preserves spacer cells and view state", () => {
    const value = project();
    value.layout.columns = 3;
    value.layout.cells[0]!.push({ kind: "spacer", spacerId: "saved-blank" });
    const parsed = parsePatternLayoutProject(serializePatternLayoutProject(value));
    expect(parsed.layout.cells[0]?.[2]).toEqual({ kind: "spacer", spacerId: "saved-blank" });
    expect(parsed.view).toEqual({ zoom: 0.75, panX: 12, panY: -8 });
  });

  it("rejects unsupported versions, duplicate pages, and malformed fingerprints", () => {
    expect(() => parsePatternLayoutProject({ ...project(), schemaVersion: 2 })).toThrow(/schemaVersion 1/);
    const duplicate = project();
    duplicate.layout.cells[0]![1] = { kind: "page", pageNumber: 1 };
    expect(() => parsePatternLayoutProject(duplicate)).toThrow(/重复/);
    expect(() => parsePatternLayoutProject({
      ...project(),
      source: { ...project().source, sha256: "bad" },
    })).toThrow(/sha256/);
    expect(() => parsePatternLayoutProject({
      ...project(),
      source: { ...project().source, absolutePath: "", relativePath: "" },
    })).toThrow(/PDF 路径/);
  });

  it("rejects duplicate spacer identifiers", () => {
    const duplicate = project();
    duplicate.layout.columns = 4;
    duplicate.layout.cells[0]!.push(
      { kind: "spacer", spacerId: "same" },
      { kind: "spacer", spacerId: "same" },
    );
    expect(() => parsePatternLayoutProject(duplicate)).toThrow(/空白块 same 重复/);
  });

  it("creates portable relative PDF paths", () => {
    expect(createRelativeSourcePath("/work/pattern/layout.pattern-layout.json", "/work/pattern/input.pdf"))
      .toBe("./input.pdf");
    expect(createRelativeSourcePath("/work/projects/layout.json", "/work/pdfs/input.pdf"))
      .toBe("../pdfs/input.pdf");
    expect(createRelativeSourcePath("C:\\work\\layout.json", "D:\\pdfs\\input.pdf"))
      .toBe("D:/pdfs/input.pdf");
  });
});
