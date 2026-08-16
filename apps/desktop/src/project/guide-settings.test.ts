import { DEFAULT_GUIDE_DETECTION_OPTIONS } from "@pdf2plt/core";
import { describe, expect, it } from "vitest";

import {
  guideCoordinateFromInput,
  guideInputValueFromCoordinate,
  guideSettingsFromLines,
} from "./guide-settings";

describe("desktop guide settings adapter", () => {
  it("copies current lines and removes stale saved seams", () => {
    const settings = guideSettingsFromLines(
      {
        mode: "manual",
        seamLeft: 10,
        seamRight: 190,
        outerLeft: 0,
        outerTop: 0,
        detection: { ...DEFAULT_GUIDE_DETECTION_OPTIONS },
      },
      {
        left: { coordinatePt: 20, source: "manual", supportPages: 0, pixelWeight: 0 },
      },
    );
    expect(settings.seamLeft).toBe(20);
    expect(settings.seamRight).toBeUndefined();
  });

  it("keeps absolute coordinates unchanged in the legacy input mode", () => {
    const pageSize = { width: 200, height: 300 };
    expect(guideInputValueFromCoordinate("right", 180, pageSize, undefined)).toBe(180);
    expect(guideCoordinateFromInput("bottom", 270, pageSize, undefined)).toBe(270);
  });

  it("converts right and bottom edge insets without changing left and top", () => {
    const pageSize = { width: 200, height: 300 };
    expect(guideCoordinateFromInput("left", 8, pageSize, "edge-insets")).toBe(8);
    expect(guideCoordinateFromInput("right", 0, pageSize, "edge-insets")).toBe(200);
    expect(guideCoordinateFromInput("bottom", 8, pageSize, "edge-insets")).toBe(292);
    expect(guideInputValueFromCoordinate("right", 180, pageSize, "edge-insets")).toBe(20);
    expect(guideInputValueFromCoordinate("bottom", 292, pageSize, "edge-insets")).toBe(8);
  });
});
