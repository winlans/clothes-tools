import { createAutomaticLayout, DEFAULT_GUIDE_DETECTION_OPTIONS } from "@pdf2plt/core";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useProjectStore } from "./project";

const savedProject = {
  schemaVersion: 1 as const,
  source: {
    absolutePath: "/patterns/input.pdf",
    relativePath: "./input.pdf",
    sha256: "a".repeat(64),
    pageCount: 2,
    pageSizePt: { width: 200, height: 300 },
  },
  layout: createAutomaticLayout(2, 1),
  guides: {
    mode: "manual" as const,
    seamLeft: 20,
    seamRight: 180,
    seamTop: 30,
    seamBottom: 270,
    outerLeft: 0,
    outerTop: 0,
    detection: { ...DEFAULT_GUIDE_DETECTION_OPTIONS },
  },
  output: { keepGuides: true, keepBackground: false, allowUnusedPages: false },
  view: { zoom: 0.75, panX: 12, panY: -8 },
};

describe("project store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("stages and completes a restored project", () => {
    const store = useProjectStore();
    store.beginOpen(savedProject, "/patterns/layout.pattern-layout.json", "layout.pattern-layout.json");
    expect(store.status).toBe("opening");
    expect(store.pendingProject).toStrictEqual(savedProject);

    store.completeOpen(savedProject);
    expect(store.status).toBe("ready");
    expect(store.pendingProject).toBeUndefined();
    expect(store.view).toEqual({ zoom: 0.75, panX: 12, panY: -8 });
    expect(store.guideSettings.seamLeft).toBe(20);
    expect(store.outputSettings.keepGuides).toBe(true);
  });

  it("keeps a visible safe error when source validation fails", () => {
    const store = useProjectStore();
    store.beginOpen(savedProject);
    store.fail("SHA-256 不一致");

    expect(store.status).toBe("error");
    expect(store.pendingProject).toBeUndefined();
    expect(store.errorMessage).toContain("SHA-256");
  });
});
