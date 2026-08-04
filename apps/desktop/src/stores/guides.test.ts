import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useGuideStore } from "./guides";

describe("guide store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("uses complete automatic detection for cropped preview", () => {
    const store = useGuideStore();
    store.applyDetection("pdf-1", {
      lines: Object.fromEntries(
        [
          ["left", 20],
          ["right", 820],
          ["top", 22],
          ["bottom", 1167],
        ].map(([direction, coordinatePt]) => [
          direction,
          { coordinatePt, source: "auto", supportPages: 8, pixelWeight: 800 },
        ]),
      ),
      missing: [],
      options: { dpi: 72, redMin: 200, otherMax: 120, redDelta: 80, minimumFraction: 0.03 },
    });

    expect(store.canPreviewCropped).toBe(true);
    expect(store.previewMode).toBe("full");
    expect(store.coordinates).toEqual({ left: 20, right: 820, top: 22, bottom: 1167 });
  });

  it("accepts manual repair for missing lines and resets for a new document", () => {
    const store = useGuideStore();
    store.initialize("pdf-1");
    const pageSize = { width: 842, height: 1191 };

    expect(store.setManual("left", 22, pageSize)).toBe(true);
    expect(store.setManual("right", 819, pageSize)).toBe(true);
    expect(store.setManual("top", 22, pageSize)).toBe(true);
    expect(store.setManual("bottom", 1167, pageSize)).toBe(true);
    expect(store.canPreviewCropped).toBe(true);
    expect(store.lines.left?.source).toBe("manual");

    store.initialize("pdf-2");
    expect(store.canPreviewCropped).toBe(false);
    expect(store.missing).toEqual(["left", "right", "top", "bottom"]);
  });

  it("restores saved seam coordinates instead of later detection defaults", () => {
    const store = useGuideStore();
    store.restore("saved", {
      mode: "manual",
      seamLeft: 21,
      seamRight: 821,
      seamTop: 23,
      seamBottom: 1165,
      outerLeft: 0,
      outerTop: 0,
      detection: { dpi: 72, redMin: 200, otherMax: 120, redDelta: 80, minimumFraction: 0.03 },
    });

    expect(store.coordinates).toEqual({ left: 21, right: 821, top: 23, bottom: 1165 });
    expect(store.previewMode).toBe("cropped");
    expect(store.lines.left?.source).toBe("manual");
  });
});
