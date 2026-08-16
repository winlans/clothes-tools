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
    expect(store.previewMode).toBe("cropped");
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

  it("accepts a right seam rounded to the displayed page width", () => {
    const store = useGuideStore();
    const pageSize = { width: 841.88977, height: 1190.55118 };

    expect(store.setManual("right", 841.89, pageSize)).toBe(true);
    expect(store.lines.right?.coordinatePt).toBe(pageSize.width);
    expect(store.setManual("right", 841.891, pageSize)).toBe(false);
  });

  it("retains unrestricted edge-inset coordinates for deferred validation", () => {
    const store = useGuideStore();
    const pageSize = { width: 200, height: 300 };

    expect(store.setManual("left", 20, pageSize, true)).toBe(true);
    expect(store.setManual("right", -50, pageSize, true)).toBe(true);
    expect(store.lines.right?.coordinatePt).toBe(-50);
    expect(store.errorMessage).toBe("");

    store.clearManual("right");
    expect(store.lines.right).toBeUndefined();
    expect(store.missing).toContain("right");
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
