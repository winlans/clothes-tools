import { describe, expect, it } from "vitest";

import { createAutomaticLayout } from "../layout/automatic-layout";
import { resolveGuideGeometry } from "./settings";

const pageSize = { width: 200, height: 300 };
const layout = createAutomaticLayout(4, 2);

describe("shared guide settings", () => {
  it("resolves automatic and manual seams to the same geometry", () => {
    const base = { outerLeft: 0, outerTop: 0 };
    const automatic = resolveGuideGeometry(
      { ...base, mode: "auto" },
      { left: 20, right: 180, top: 30, bottom: 270 },
      pageSize,
      layout,
    );
    const manual = resolveGuideGeometry(
      {
        ...base,
        mode: "manual",
        seamLeft: 20,
        seamRight: 180,
        seamTop: 30,
        seamBottom: 270,
      },
      {},
      pageSize,
      layout,
    );
    expect(manual).toEqual(automatic);
    expect(automatic.geometry).toMatchObject({ width: 360, height: 540 });
  });

  it("uses full-page seams in none mode while retaining outer boundaries", () => {
    const resolved = resolveGuideGeometry(
      {
        mode: "none",
        outerLeft: 5,
        outerRight: 195,
        outerTop: 10,
        outerBottom: 290,
      },
      { left: 20, right: 180, top: 30, bottom: 270 },
      pageSize,
      layout,
    );
    expect(resolved.coordinates).toMatchObject({ left: 0, right: 200, top: 0, bottom: 300 });
    expect(resolved.geometry).toMatchObject({ width: 390, height: 580 });
  });

  it("rejects missing seams and invalid outer boundaries", () => {
    expect(() => resolveGuideGeometry(
      { mode: "manual", outerLeft: 0, outerTop: 0 },
      {},
      pageSize,
      layout,
    )).toThrow(/缺少左拼接线/);
    expect(() => resolveGuideGeometry(
      {
        mode: "none",
        outerLeft: 190,
        outerRight: 180,
        outerTop: 0,
      },
      {},
      pageSize,
      layout,
    )).toThrow(/左右外边界/);
  });
});
