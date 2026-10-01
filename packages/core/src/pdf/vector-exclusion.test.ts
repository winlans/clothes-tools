import mupdf from "mupdf";
import { describe, expect, it } from "vitest";

import {
  createVectorExclusionDevice,
  type VectorObjectExclusionRule,
} from "./vector-exclusion";

const pageSize = { width: 200, height: 200 };
const identity: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
const black: [number, number, number] = [0, 0, 0];

function rule(
  strokes: VectorObjectExclusionRule["strokes"],
): VectorObjectExclusionRule {
  return {
    id: "rule-1",
    sourcePageNumber: 1,
    scope: "all-pages",
    strokes,
  };
}

function linePath(y: number) {
  const path = new mupdf.Path();
  path.moveTo(10, y);
  path.lineTo(190, y);
  return path;
}

function strokeState(width = 1) {
  return new mupdf.StrokeState({
    lineCap: "Round",
    lineJoin: "Round",
    lineWidth: width,
    miterLimit: 10,
  });
}

describe("vector object brush exclusions", () => {
  it("selects an entire stroked path as soon as the brush touches it", () => {
    const filter = createVectorExclusionDevice(
      mupdf,
      undefined,
      1,
      pageSize,
      [rule([{ operation: "add", radiusPt: 3, points: [{ x: 100, y: 47 }] }])],
      "inspect",
    );
    const path = linePath(50);
    const stroke = strokeState(1);

    filter.device.strokePath(path, stroke, identity, mupdf.ColorSpace.DeviceRGB, black, 1);

    expect(filter.selectedObjects).toEqual([
      expect.objectContaining({ objectId: 1, kind: "path" }),
    ]);
    filter.destroy();
    stroke.destroy();
    path.destroy();
  });

  it("uses subtract strokes to remove false-positive objects", () => {
    const filter = createVectorExclusionDevice(
      mupdf,
      undefined,
      1,
      pageSize,
      [rule([
        { operation: "add", radiusPt: 4, points: [{ x: 100, y: 50 }] },
        { operation: "subtract", radiusPt: 4, points: [{ x: 120, y: 50 }] },
      ])],
      "inspect",
    );
    const path = linePath(50);
    const stroke = strokeState();

    filter.device.strokePath(path, stroke, identity, mupdf.ColorSpace.DeviceRGB, black, 1);

    expect(filter.selectedObjects).toHaveLength(0);
    filter.destroy();
    stroke.destroy();
    path.destroy();
  });

  it("does not apply a current-page rule to another page", () => {
    const currentPageRule = {
      ...rule([{ operation: "add" as const, radiusPt: 5, points: [{ x: 100, y: 50 }] }]),
      scope: "current-page" as const,
    };
    const filter = createVectorExclusionDevice(
      mupdf,
      undefined,
      2,
      pageSize,
      [currentPageRule],
      "inspect",
    );
    const path = linePath(50);
    const stroke = strokeState();

    filter.device.strokePath(path, stroke, identity, mupdf.ColorSpace.DeviceRGB, black, 1);

    expect(filter.selectedObjects).toHaveLength(0);
    filter.destroy();
    stroke.destroy();
    path.destroy();
  });

  it("ignores a page-sized filled background", () => {
    const filter = createVectorExclusionDevice(
      mupdf,
      undefined,
      1,
      pageSize,
      [rule([{ operation: "add", radiusPt: 5, points: [{ x: 100, y: 100 }] }])],
      "inspect",
    );
    const background = new mupdf.Path();
    background.rect(0, 0, 200, 200);

    filter.device.fillPath(
      background,
      false,
      identity,
      mupdf.ColorSpace.DeviceRGB,
      [1, 1, 1],
      1,
    );

    expect(filter.selectedObjects).toHaveLength(0);
    filter.destroy();
    background.destroy();
  });

  it("ignores a partial white background while selecting artwork above it", () => {
    const filter = createVectorExclusionDevice(
      mupdf,
      undefined,
      1,
      pageSize,
      [rule([{ operation: "add", radiusPt: 5, points: [{ x: 100, y: 50 }] }])],
      "inspect",
    );
    const background = new mupdf.Path();
    background.rect(0, 0, 200, 100);
    const artwork = linePath(50);
    const stroke = strokeState();

    filter.device.fillPath(
      background,
      false,
      identity,
      mupdf.ColorSpace.DeviceRGB,
      [1, 1, 1],
      1,
    );
    filter.device.strokePath(
      artwork,
      stroke,
      identity,
      mupdf.ColorSpace.DeviceRGB,
      black,
      1,
    );

    expect(filter.selectedObjects).toEqual([
      expect.objectContaining({ objectId: 2, kind: "path" }),
    ]);
    filter.destroy();
    stroke.destroy();
    artwork.destroy();
    background.destroy();
  });

  it("selects a complete text paint operation by its transformed bounds", () => {
    const filter = createVectorExclusionDevice(
      mupdf,
      undefined,
      1,
      pageSize,
      [rule([{ operation: "add", radiusPt: 5, points: [{ x: 20, y: 80 }, { x: 180, y: 80 }] }])],
      "inspect",
    );
    const font = new mupdf.Font("Helvetica");
    const text = new mupdf.Text();
    text.showString(font, [24, 0, 0, 24, 20, 80], "Watermark");

    filter.device.fillText(text, identity, mupdf.ColorSpace.DeviceRGB, black, 1);

    expect(filter.selectedObjects).toEqual([
      expect.objectContaining({ objectId: 1, kind: "text" }),
    ]);
    filter.destroy();
    text.destroy();
    font.destroy();
  });

  it("uses reference-page object kinds to avoid cross-page path collisions", () => {
    const constrainedRule = {
      ...rule([{ operation: "add" as const, radiusPt: 8, points: [{ x: 100, y: 80 }] }]),
      objectKinds: ["text" as const],
    };
    const filter = createVectorExclusionDevice(
      mupdf,
      undefined,
      2,
      pageSize,
      [constrainedRule],
      "inspect",
    );
    const path = linePath(80);
    const stroke = strokeState();
    const font = new mupdf.Font("Helvetica");
    const text = new mupdf.Text();
    text.showString(font, [18, 0, 0, 18, 75, 80], "Page 2");

    filter.device.strokePath(path, stroke, identity, mupdf.ColorSpace.DeviceRGB, black, 1);
    filter.device.fillText(text, identity, mupdf.ColorSpace.DeviceRGB, black, 1);

    expect(filter.selectedObjects).toEqual([
      expect.objectContaining({ objectId: 2, kind: "text" }),
    ]);
    filter.destroy();
    text.destroy();
    font.destroy();
    stroke.destroy();
    path.destroy();
  });
});
