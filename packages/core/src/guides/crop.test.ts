import { describe, expect, it } from "vitest";

import { createAutomaticLayout } from "../layout/automatic-layout";
import { createLayoutCropGeometry } from "./crop";

describe("layout crop geometry", () => {
  it("keeps full page geometry when no guides are active", () => {
    const geometry = createLayoutCropGeometry(
      createAutomaticLayout(6, 2),
      { width: 200, height: 300 },
    );

    expect(geometry).toMatchObject({ width: 600, height: 600 });
    expect(geometry.columns.map((column) => column.outputStart)).toEqual([0, 200, 400]);
  });

  it("removes overlap while retaining the outer page edges", () => {
    const geometry = createLayoutCropGeometry(
      createAutomaticLayout(6, 2),
      { width: 200, height: 300 },
      { left: 20, right: 180, top: 30, bottom: 270 },
    );

    expect(geometry).toMatchObject({ width: 520, height: 540 });
    expect(geometry.columns).toEqual([
      { outputStart: 0, sourceStart: 0, sourceEnd: 180, size: 180 },
      { outputStart: 180, sourceStart: 20, sourceEnd: 180, size: 160 },
      { outputStart: 340, sourceStart: 20, sourceEnd: 200, size: 180 },
    ]);
    expect(geometry.rows).toEqual([
      { outputStart: 0, sourceStart: 0, sourceEnd: 270, size: 270 },
      { outputStart: 270, sourceStart: 30, sourceEnd: 300, size: 270 },
    ]);
  });
});
