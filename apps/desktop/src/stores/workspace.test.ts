import { DEFAULT_GUIDE_DETECTION_OPTIONS } from "@pdf2plt/core";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it } from "vitest";

import type { PdfImportCandidate } from "./document-session";
import { useWorkspaceStore } from "./workspace";

function pendingCandidate(index: number, starts: number[]): PdfImportCandidate {
  return {
    fileName: `file-${index}.pdf`,
    sourceKey: `path:/tmp/file-${index}.pdf`,
    sourcePath: `/tmp/file-${index}.pdf`,
    load() {
      starts.push(index);
      return new Promise(() => undefined);
    },
  };
}

describe("workspace store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("opens ordered isolated tabs and limits concurrent initialization", () => {
    const workspace = useWorkspaceStore();
    const starts: number[] = [];
    const result = workspace.enqueueCandidates([
      pendingCandidate(1, starts),
      pendingCandidate(2, starts),
      pendingCandidate(3, starts),
    ]);

    expect(result.opened).toBe(3);
    expect(starts).toEqual([1, 2]);
    expect(workspace.tabs.map((tab) => tab.ui.loadStatus)).toEqual([
      "loading",
      "loading",
      "queued",
    ]);
    expect(workspace.activeSession?.source.fileName).toBe("file-1.pdf");

    const [first, second] = workspace.tabs;
    first?.layoutStore.initialize("first", 6);
    second?.layoutStore.initialize("second", 2);
    first?.layoutStore.setPagesPerColumn(2);
    expect(first?.layoutStore.layout).toMatchObject({ rows: 2, columns: 3 });
    expect(second?.layoutStore.layout).toMatchObject({ rows: 3, columns: 1 });
    workspace.disposeAll();
  });

  it("focuses duplicate paths and selects the right neighbour when closing", () => {
    const workspace = useWorkspaceStore();
    const starts: number[] = [];
    const candidates = [pendingCandidate(1, starts), pendingCandidate(2, starts), pendingCandidate(3, starts)];
    workspace.enqueueCandidates(candidates);
    const duplicate = workspace.enqueueCandidates([pendingCandidate(2, starts)]);
    expect(duplicate).toMatchObject({ opened: 0, duplicates: 1 });
    expect(workspace.activeSession?.source.fileName).toBe("file-2.pdf");

    const secondId = workspace.activeSession?.id;
    if (!secondId) throw new Error("missing active tab");
    workspace.remove(secondId);
    expect(workspace.activeSession?.source.fileName).toBe("file-3.pdf");
    workspace.disposeAll();
  });

  it("keeps dirty and grid preferences isolated per tab", () => {
    const workspace = useWorkspaceStore();
    const starts: number[] = [];
    workspace.enqueueCandidates([pendingCandidate(1, starts), pendingCandidate(2, starts)]);
    const [first, second] = workspace.tabs;
    if (!first || !second) throw new Error("missing tabs");

    first.markDirty();
    first.ui.showGrid = true;
    expect(first.ui).toMatchObject({ dirty: true, showGrid: true });
    expect(second.ui).toMatchObject({ dirty: false, showGrid: false });
    workspace.disposeAll();
  });

  it("isolates edge-inset inputs to zero-red-line content matching", async () => {
    const workspace = useWorkspaceStore();
    const starts: number[] = [];
    workspace.enqueueCandidates([pendingCandidate(1, starts), pendingCandidate(2, starts)]);
    const [contentSession, redSession] = workspace.tabs;
    if (!contentSession || !redSession) throw new Error("missing tabs");

    for (const [index, session] of [contentSession, redSession].entries()) {
      session.documentStore.info = {
        documentId: `pdf-${index + 1}`,
        pageCount: 2,
        pageSizePt: { width: 200, height: 300 },
        pages: [
          { pageNumber: 1, width: 200, height: 300 },
          { pageNumber: 2, width: 200, height: 300 },
        ],
      };
    }
    await nextTick();

    contentSession.documentStore.guideDetection = {
      lines: {},
      missing: ["left", "right", "top", "bottom"],
      options: { ...DEFAULT_GUIDE_DETECTION_OPTIONS },
      contentOverlap: { applied: false, confidence: 0.4 },
    };
    redSession.documentStore.guideDetection = {
      lines: {
        left: { coordinatePt: 8, source: "auto", supportPages: 2, pixelWeight: 100 },
      },
      missing: ["right", "top", "bottom"],
      options: { ...DEFAULT_GUIDE_DETECTION_OPTIONS },
    };
    await nextTick();

    expect(contentSession.projectStore.guideSettings.inputMode).toBe("edge-insets");
    expect(redSession.projectStore.guideSettings.inputMode).toBeUndefined();
    workspace.disposeAll();
  });
});
