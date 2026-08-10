// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_DETAIL_PREVIEW_CACHE,
  MAX_PREVIEW_CACHE,
  MAX_VECTOR_PREVIEW_CACHE,
  usePdfDocumentStore,
} from "./pdf-document";

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
        type: "export-vector",
        format: "svg",
        requestId: 3,
        svgOptions: {
          removeGuides: true,
          removeBackground: true,
          rotation: 0,
        },
        pltOptions: { curveToleranceMm: 0.05 },
      }),
    );
    store.handleWorkerMessage({
      type: "vector-export",
      requestId: 3,
      format: "svg",
      bytes: new TextEncoder().encode("<svg/>") as Uint8Array<ArrayBuffer>,
      widthPt: 200,
      heightPt: 300,
      pageInstances: 1,
      visibleObjects: 4,
      paths: 0,
      segments: 0,
      omittedImages: 0,
      warnings: [],
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

  it("keeps a bounded LRU preview cache while pinning visible pages", () => {
    const store = usePdfDocumentStore();
    store.requestId = 11;
    store.info = {
      documentId: "large-pdf",
      pageCount: 24,
      pageSizePt: { width: 200, height: 300 },
      pages: Array.from({ length: 24 }, (_, index) => ({
        pageNumber: index + 1,
        width: 200,
        height: 300,
      })),
    };
    store.visiblePreviewPages = [1];

    for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
      store.handleWorkerMessage({
        type: "preview",
        requestId: 11,
        pageNumber,
        width: 100,
        height: 150,
        bytes: new Uint8Array([pageNumber]),
      });
    }

    expect(Object.keys(store.previews)).toHaveLength(MAX_PREVIEW_CACHE);
    expect(store.previews[1]).toBeDefined();
    expect(store.previews[2]).toBeUndefined();
    expect(store.previews[3]).toBeUndefined();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("can retain and request every page required by the active layout", () => {
    const store = usePdfDocumentStore();
    store.requestId = 21;
    store.info = {
      documentId: "large-layout",
      pageCount: 24,
      pageSizePt: { width: 200, height: 300 },
      pages: Array.from({ length: 24 }, (_, index) => ({
        pageNumber: index + 1,
        width: 200,
        height: 300,
      })),
    };
    const postMessage = vi.fn();
    store.worker = { postMessage } as unknown as Worker;
    const layoutPages = Array.from({ length: 24 }, (_, index) => index + 1);

    store.setPreviewCacheLimit(layoutPages.length);
    store.prioritizePreviews(layoutPages);

    expect(store.previewCacheLimit).toBe(24);
    expect(store.visiblePreviewPages).toEqual(layoutPages);
    expect(postMessage).toHaveBeenCalledWith({
      type: "request-previews",
      requestId: 21,
      pageNumbers: layoutPages,
    });
  });

  it("requests and bounds higher-resolution previews for currently visible pages", () => {
    const store = usePdfDocumentStore();
    store.requestId = 23;
    store.info = {
      documentId: "detail-preview",
      pageCount: 6,
      pageSizePt: { width: 200, height: 300 },
      pages: Array.from({ length: 6 }, (_, index) => ({
        pageNumber: index + 1,
        width: 200,
        height: 300,
      })),
    };
    store.previews = {
      1: { pageNumber: 1, width: 1067, height: 1600, url: "blob:base" },
    };
    const postMessage = vi.fn();
    store.worker = { postMessage } as unknown as Worker;

    store.requestDetailPreviews([1, 2, 3, 4, 5], 3200);
    expect(postMessage).toHaveBeenCalledWith({
      type: "request-detail-previews",
      requestId: 23,
      pageNumbers: [1, 2, 3, 4],
      maxLongEdge: 3200,
    });

    for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
      store.handleWorkerMessage({
        type: "detail-preview",
        requestId: 23,
        pageNumber,
        maxLongEdge: 3200,
        width: 2133,
        height: 3200,
        bytes: new Uint8Array([pageNumber]),
      });
    }

    expect(Object.keys(store.detailPreviews)).toHaveLength(MAX_DETAIL_PREVIEW_CACHE);
    expect(store.detailPreviews[1]).toBeUndefined();
    expect(store.previewList.find((preview) => preview.pageNumber === 2)?.height).toBe(3200);
    postMessage.mockClear();
    store.requestDetailPreviews([2], 2400);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("prefers SVG workspace previews and uses raster detail only after SVG failure", () => {
    const store = usePdfDocumentStore();
    store.requestId = 24;
    store.info = {
      documentId: "vector-preview",
      pageCount: 30,
      pageSizePt: { width: 200, height: 300 },
      pages: Array.from({ length: 30 }, (_, index) => ({
        pageNumber: index + 1,
        width: 200,
        height: 300,
      })),
    };
    store.previews = {
      1: { pageNumber: 1, width: 1067, height: 1600, url: "blob:raster" },
    };
    const postMessage = vi.fn();
    store.worker = { postMessage } as unknown as Worker;

    const visible = Array.from({ length: 30 }, (_, index) => index + 1);
    store.requestCanvasPreviews(visible, 3200);
    expect(postMessage).toHaveBeenCalledWith({
      type: "request-vector-previews",
      requestId: 24,
      pageNumbers: visible.slice(0, MAX_VECTOR_PREVIEW_CACHE),
    });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "request-detail-previews" }),
    );

    store.handleWorkerMessage({
      type: "vector-preview",
      requestId: 24,
      pageNumber: 1,
      width: 200,
      height: 300,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    expect(store.previewList[0]).toMatchObject({
      pageNumber: 1,
      url: "blob:preview-1",
      format: "svg",
    });

    store.handleWorkerMessage({
      type: "vector-preview-error",
      requestId: 24,
      pageNumber: 2,
      code: "invalid-page-svg",
      message: "invalid",
    });
    postMessage.mockClear();
    store.requestCanvasPreviews([2], 3200);
    expect(postMessage).toHaveBeenCalledWith({
      type: "request-detail-previews",
      requestId: 24,
      pageNumbers: [2],
      maxLongEdge: 3200,
    });
  });

  it("requests and atomically stores the combined SVG used by fullscreen preview", () => {
    const store = usePdfDocumentStore();
    store.requestId = 25;
    store.info = {
      documentId: "layout-svg-preview",
      pageCount: 1,
      pageSizePt: { width: 200, height: 300 },
      pages: [{ pageNumber: 1, width: 200, height: 300 }],
    };
    const postMessage = vi.fn();
    store.worker = { postMessage } as unknown as Worker;
    const layout = {
      rows: 1,
      columns: 1,
      traversal: "column-major" as const,
      cells: [[{ kind: "page" as const, pageNumber: 1 }]],
    };

    store.requestLayoutSvgPreview(
      layout,
      { left: 20, right: 180, top: 30, bottom: 270 },
    );
    expect(store.layoutSvgPreviewStatus).toBe("running");
    expect(postMessage).toHaveBeenCalledWith({
      type: "request-layout-svg-preview",
      requestId: 25,
      layoutPreviewRequestId: 1,
      layout,
      guides: { left: 20, right: 180, top: 30, bottom: 270 },
      removeGuides: true,
      guideDetection: store.previewGuideDetection,
    });

    store.handleWorkerMessage({
      type: "layout-svg-preview",
      requestId: 25,
      layoutPreviewRequestId: 1,
      width: 160,
      height: 240,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    expect(store.layoutSvgPreviewStatus).toBe("ready");
    expect(store.layoutSvgPreview).toMatchObject({
      pageNumber: 0,
      width: 160,
      height: 240,
      url: "blob:preview-1",
      format: "svg",
    });
  });

  it("renders magnifier regions from the PDF source at the requested resolution", async () => {
    const store = usePdfDocumentStore();
    store.requestId = 22;
    store.info = {
      documentId: "vector-magnifier",
      pageCount: 1,
      pageSizePt: { width: 200, height: 300 },
      pages: [{ pageNumber: 1, width: 200, height: 300 }],
    };
    const postMessage = vi.fn();
    store.worker = { postMessage } as unknown as Worker;

    const rendered = store.renderRegion(1, {
      x: 40,
      y: 60,
      width: 32,
      height: 22,
      outputWidth: 640,
      outputHeight: 440,
    });

    expect(postMessage).toHaveBeenCalledWith({
      type: "render-region",
      requestId: 22,
      regionRequestId: 1,
      pageNumber: 1,
      options: expect.objectContaining({
        x: 40,
        y: 60,
        width: 32,
        height: 22,
        outputWidth: 640,
        outputHeight: 440,
        removeGuides: true,
      }),
    });
    store.handleWorkerMessage({
      type: "region",
      requestId: 22,
      regionRequestId: 1,
      pageNumber: 1,
      width: 640,
      height: 440,
      bytes: new Uint8Array([137, 80, 78, 71]),
    });

    await expect(rendered).resolves.toMatchObject({
      pageNumber: 1,
      width: 640,
      height: 440,
    });
  });

  it("rebuilds cached previews when red-guide removal changes", () => {
    const store = usePdfDocumentStore();
    store.requestId = 22;
    store.info = {
      documentId: "preview-guides",
      pageCount: 2,
      pageSizePt: { width: 200, height: 300 },
      pages: [
        { pageNumber: 1, width: 200, height: 300 },
        { pageNumber: 2, width: 200, height: 300 },
      ],
    };
    store.previews = {
      1: { pageNumber: 1, width: 100, height: 150, url: "blob:with-guides" },
    };
    store.previewOrder = [1];
    store.visiblePreviewPages = [1, 2];
    const postMessage = vi.fn();
    store.worker = { postMessage } as unknown as Worker;
    const options = {
      dpi: 96,
      redMin: 190,
      otherMax: 110,
      redDelta: 70,
      minimumFraction: 0.04,
    };

    store.setPreviewGuideRemoval(false, options);

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:with-guides");
    expect(store.previews).toEqual({});
    expect(store.previewRemoveGuides).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({
      type: "configure-preview-guides",
      requestId: 22,
      removeGuides: false,
      options,
      pageNumbers: [1, 2],
    });
  });

  it("prioritizes missing visible previews and cancels export cooperatively", async () => {
    const store = usePdfDocumentStore();
    store.requestId = 12;
    store.info = {
      documentId: "pdf-1",
      pageCount: 3,
      pageSizePt: { width: 200, height: 300 },
      pages: Array.from({ length: 3 }, (_, index) => ({
        pageNumber: index + 1,
        width: 200,
        height: 300,
      })),
    };
    const postMessage = vi.fn();
    store.worker = { postMessage } as unknown as Worker;
    store.prioritizePreviews([3]);
    expect(postMessage).toHaveBeenCalledWith({
      type: "request-previews",
      requestId: 12,
      pageNumbers: [3],
    });

    const exported = store.exportSvg(
      {
        rows: 1,
        columns: 1,
        traversal: "column-major",
        cells: [[{ kind: "page", pageNumber: 1 }]],
      },
      { left: 0, right: 200, top: 0, bottom: 300 },
    );
    store.cancelExport();
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "cancel-task",
      requestId: 12,
      task: "export",
    });
    store.handleWorkerMessage({ type: "task-cancelled", requestId: 12, task: "export" });

    await expect(exported).rejects.toThrow(/取消/);
    expect(store.exportStatus).toBe("cancelled");
  });

  it("cancels preview and detection tasks without closing the document", async () => {
    const store = usePdfDocumentStore();
    store.requestId = 13;
    store.status = "loading";
    store.previewStatus = "running";
    store.detectionStatus = "idle";
    store.info = {
      documentId: "pdf-1",
      pageCount: 3,
      pageSizePt: { width: 200, height: 300 },
      pages: Array.from({ length: 3 }, (_, index) => ({
        pageNumber: index + 1,
        width: 200,
        height: 300,
      })),
    };
    const postMessage = vi.fn();
    store.worker = { postMessage } as unknown as Worker;

    store.cancelPreview();
    store.handleWorkerMessage({ type: "task-cancelled", requestId: 13, task: "preview" });
    expect(postMessage).toHaveBeenCalledWith({
      type: "cancel-task",
      requestId: 13,
      task: "preview",
    });
    expect(store.status).toBe("ready");
    expect(store.previewStatus).toBe("cancelled");

    const detection = store.detectGuides({
      dpi: 144,
      redMin: 200,
      otherMax: 120,
      redDelta: 80,
      minimumFraction: 0.03,
    });
    store.cancelDetection();
    store.handleWorkerMessage({ type: "task-cancelled", requestId: 13, task: "detection" });
    await expect(detection).rejects.toThrow(/取消/);
    expect(store.detectionStatus).toBe("cancelled");
    expect(store.info?.documentId).toBe("pdf-1");
  });
});
