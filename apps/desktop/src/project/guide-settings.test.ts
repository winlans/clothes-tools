import { DEFAULT_GUIDE_DETECTION_OPTIONS } from "@pdf2plt/core";
import { describe, expect, it } from "vitest";

import { guideSettingsFromLines } from "./guide-settings";

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
});
