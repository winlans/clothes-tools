import { createPinia, setActivePinia } from "pinia";
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
});
