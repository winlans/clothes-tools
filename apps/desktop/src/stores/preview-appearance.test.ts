import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PREVIEW_APPEARANCE,
  previewColorTreatment,
  previewInkLayerOpacities,
  usePreviewAppearanceStore,
} from "./preview-appearance";

describe("global preview appearance", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("updates colors and line weight, then restores defaults", () => {
    const store = usePreviewAppearanceStore();
    expect(store.$state).toEqual({
      foregroundColor: "#000000",
      backgroundColor: "#ffffff",
      lineWeight: 5,
    });
    store.setForegroundColor("#123456");
    store.setBackgroundColor("#fedcba");
    store.setLineWeight(2.4);

    expect(store.$state).toEqual({
      foregroundColor: "#123456",
      backgroundColor: "#fedcba",
      lineWeight: 2.4,
    });
    expect(store.isDefault).toBe(false);

    store.reset();
    expect(store.$state).toEqual(DEFAULT_PREVIEW_APPEARANCE);
    expect(store.isDefault).toBe(true);
  });

  it("turns visual line weight into shared multiply layers", () => {
    expect(previewInkLayerOpacities(0.5)).toEqual([0.5]);
    const weighted = previewInkLayerOpacities(1.32);
    expect(weighted[0]).toBe(1);
    expect(weighted[1]).toBeCloseTo(0.32);
    expect(previewInkLayerOpacities(3)).toEqual([1, 1, 1]);
    expect(previewInkLayerOpacities(10)).toHaveLength(10);
    expect(previewInkLayerOpacities(20)).toHaveLength(10);
  });

  it("clamps the global line weight at ten", () => {
    const store = usePreviewAppearanceStore();
    store.setLineWeight(20);
    expect(store.lineWeight).toBe(10);
  });

  it("supports both dark-on-light and light-on-dark preview colors", () => {
    expect(previewColorTreatment("#000000", "#ffffff")).toEqual({
      mode: "source",
      compositeForegroundColor: "#000000",
    });
    expect(previewColorTreatment("#f5f5f5", "#101214")).toEqual({
      mode: "dark-background",
      compositeForegroundColor: "#f4f4f4",
    });
  });
});
