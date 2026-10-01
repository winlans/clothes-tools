import { describe, expect, it } from "vitest";

import { spacerAppearance } from "./spacer-appearance";

describe("spacer appearance", () => {
  it("uses a higher-contrast palette on dark backgrounds", () => {
    const light = spacerAppearance("#ffffff");
    const dark = spacerAppearance("#111827");
    expect(dark.accentColor).not.toBe(light.accentColor);
    expect(dark.washOpacity).toBeGreaterThan(light.washOpacity);
  });

  it("uses one understated visual treatment for every spacer", () => {
    expect(spacerAppearance("#ffffff")).toEqual({
      accentColor: "#2b747c",
      washOpacity: 0.045,
      hatchOpacity: 0.16,
      borderOpacity: 0.58,
    });
  });
});
