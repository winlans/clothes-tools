// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePdfDocumentStore } from "./pdf-document";

const createObjectURL = vi.fn(() => "blob:preview-1");
const revokeObjectURL = vi.fn();

describe("pdf document store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
  });

  it("collects document metadata, previews, and progress from the worker", () => {
    const store = usePdfDocumentStore();
    store.requestId = 7;
    store.status = "loading";

    store.handleWorkerMessage({
      type: "document",
      requestId: 7,
      info: {
        documentId: "pdf-1",
        pageCount: 2,
        pageSizePt: { width: 841.89, height: 1190.551 },
        pages: [
          { pageNumber: 1, width: 841.89, height: 1190.551 },
          { pageNumber: 2, width: 841.89, height: 1190.551 },
        ],
      },
    });
    store.handleWorkerMessage({
      type: "guides",
      requestId: 7,
      result: {
        lines: {},
        missing: ["left", "right", "top", "bottom"],
        options: {
          dpi: 72,
          redMin: 200,
          otherMax: 120,
          redDelta: 80,
          minimumFraction: 0.03,
        },
      },
    });
    store.handleWorkerMessage({
      type: "preview",
      requestId: 7,
      pageNumber: 1,
      width: 566,
      height: 800,
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    store.handleWorkerMessage({
      type: "progress",
      requestId: 7,
      completed: 1,
      total: 2,
    });
    store.handleWorkerMessage({ type: "complete", requestId: 7 });

    expect(store.info?.pageCount).toBe(2);
    expect(store.previewList).toEqual([
      {
        pageNumber: 1,
        width: 566,
        height: 800,
        url: "blob:preview-1",
      },
    ]);
    expect(store.progress).toEqual({ completed: 1, total: 2 });
    expect(store.guideDetection?.missing).toEqual(["left", "right", "top", "bottom"]);
    expect(store.status).toBe("ready");
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it("releases preview URLs and ignores stale worker messages", () => {
    const store = usePdfDocumentStore();
    store.requestId = 4;
    store.previews = {
      1: { pageNumber: 1, width: 100, height: 200, url: "blob:old-preview" },
    };
    const postMessage = vi.fn();
    store.worker = { postMessage } as unknown as Worker;

    store.close();
    store.handleWorkerMessage({
      type: "error",
      requestId: 4,
      code: "stale-error",
      message: "should be ignored",
    });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:old-preview");
    expect(postMessage).toHaveBeenCalledWith({ type: "close", requestId: 5 });
    expect(store.status).toBe("idle");
    expect(store.errorMessage).toBe("");
    expect(store.previewList).toEqual([]);
  });

  it("requests a vector export and resolves its summary", async () => {
    const store = usePdfDocumentStore();
    store.requestId = 3;
    store.info = {
      documentId: "pdf-1",
      pageCount: 1,
      pageSizePt: { width: 200, height: 300 },
      pages: [{ pageNumber: 1, width: 200, height: 300 }],
    };
    const postMessage = vi.fn();
    store.worker = { postMessage } as unknown as Worker;
    const exported = store.exportSvg(
      {
        rows: 1,
        columns: 1,
        traversal: "column-major",
        cells: [[{ kind: "page", pageNumber: 1 }]],
      },
      { left: 20, right: 180, top: 30, bottom: 270 },
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "export-svg",
        requestId: 3,
        options: { removeGuides: true, removeBackground: true },
      }),
    );
    store.handleWorkerMessage({
      type: "svg-export",
      requestId: 3,
      bytes: new TextEncoder().encode("<svg/>") as Uint8Array<ArrayBuffer>,
      widthPt: 200,
      heightPt: 300,
      pageInstances: 1,
      visibleObjects: 4,
    });

    await expect(exported).resolves.toMatchObject({ widthPt: 200, pageInstances: 1 });
    expect(store.exportStatus).toBe("complete");
    expect(store.exportSummary?.visibleObjects).toBe(4);
  });

  it("reruns guide detection with validated inspector thresholds", async () => {
    const store = usePdfDocumentStore();
    store.requestId = 9;
    store.info = {
      documentId: "pdf-1",
      pageCount: 1,
      pageSizePt: { width: 200, height: 300 },
      pages: [{ pageNumber: 1, width: 200, height: 300 }],
    };
    const postMessage = vi.fn();
    store.worker = { postMessage } as unknown as Worker;
    const options = {
      dpi: 96,
      redMin: 190,
      otherMax: 110,
      redDelta: 70,
      minimumFraction: 0.04,
    };
    const detection = store.detectGuides(options);

    expect(store.detectionStatus).toBe("running");
    expect(postMessage).toHaveBeenCalledWith({
      type: "detect-guides",
      requestId: 9,
      options,
    });
    store.handleWorkerMessage({
      type: "guides",
      requestId: 9,
      result: { lines: {}, missing: ["left", "right", "top", "bottom"], options },
    });

    await expect(detection).resolves.toMatchObject({ options });
    expect(store.detectionStatus).toBe("idle");
  });
});
