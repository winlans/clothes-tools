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
});
