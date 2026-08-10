/// <reference lib="webworker" />

import {
  buildCorelPlt,
  buildCombinedSvg,
  DEFAULT_GUIDE_DETECTION_OPTIONS,
  flattenLayout,
  openMuPdfDocument,
  Pdf2PltError,
  prepareSvgPreview,
  type GuideDetectionOptions,
  type OpenDocumentResult,
} from "@pdf2plt/core";
import mupdfWasmUrl from "@mupdf-wasm?url";

import type { PdfWorkerRequest, PdfWorkerResponse } from "./protocol";

const worker = self as unknown as DedicatedWorkerGlobalScope;
const mupdfGlobal = globalThis as typeof globalThis & {
  $libmupdf_wasm_Module?: {
    locateFile(path: string): string;
  };
};
type TaskKind = "preview" | "detection" | "export";

let currentDocument: OpenDocumentResult | undefined;
let activeRequestId = 0;
let previewLongEdge = 1600;
let removePreviewGuides = true;
let previewGuideDetection: GuideDetectionOptions = {
  ...DEFAULT_GUIDE_DETECTION_OPTIONS,
};
let previewQueue: number[] = [];
let detailPreviewQueue: Array<{ pageNumber: number; maxLongEdge: number }> = [];
let vectorPreviewQueue: number[] = [];
let previewCompleted = new Set<number>();
let previewTargetCount = 0;
let previewGeneration = 0;
let previewRunningGeneration: number | undefined;
let layoutPreviewGeneration = 0;
const cancelledTasks = new Set<TaskKind>();

mupdfGlobal.$libmupdf_wasm_Module = {
  locateFile(path: string) {
    return path.endsWith("mupdf-wasm.wasm") ? mupdfWasmUrl : path;
  },
};

function respond(message: PdfWorkerResponse, transfer: Transferable[] = []) {
  worker.postMessage(message, transfer);
}

function serializeError(error: unknown): { code: string; message: string } {
  if (error instanceof Pdf2PltError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "pdf-worker-error", message: error.message };
  }
  return { code: "pdf-worker-error", message: "PDF 处理发生未知错误。" };
}

function yieldControl(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function queuePreviews(pageNumbers: readonly number[], priority: boolean) {
  const valid = pageNumbers.filter(
    (pageNumber) =>
      Number.isInteger(pageNumber) &&
      pageNumber >= 1 &&
      pageNumber <= (currentDocument?.info.pageCount ?? 0),
  );
  const incoming = [...new Set(valid)];
  const remaining = previewQueue.filter((pageNumber) => !incoming.includes(pageNumber));
  previewQueue = priority ? [...incoming, ...remaining] : [...remaining, ...incoming];
  previewTargetCount = new Set([...previewCompleted, ...previewQueue]).size;
}

function queueDetailPreviews(pageNumbers: readonly number[], maxLongEdge: number) {
  const valid = [...new Set(pageNumbers)].filter(
    (pageNumber) =>
      Number.isInteger(pageNumber) &&
      pageNumber >= 1 &&
      pageNumber <= (currentDocument?.info.pageCount ?? 0),
  );
  const incoming = valid.map((pageNumber) => ({ pageNumber, maxLongEdge }));
  const incomingPages = new Set(valid);
  detailPreviewQueue = [
    ...incoming,
    ...detailPreviewQueue.filter((entry) => !incomingPages.has(entry.pageNumber)),
  ];
}

function queueVectorPreviews(pageNumbers: readonly number[]) {
  const valid = [...new Set(pageNumbers)].filter(
    (pageNumber) =>
      Number.isInteger(pageNumber) &&
      pageNumber >= 1 &&
      pageNumber <= (currentDocument?.info.pageCount ?? 0),
  );
  const incomingPages = new Set(valid);
  vectorPreviewQueue = [
    ...valid,
    ...vectorPreviewQueue.filter((pageNumber) => !incomingPages.has(pageNumber)),
  ];
}

async function drainPreviewQueue(requestId: number, generation: number) {
  if (previewRunningGeneration === generation) return;
  previewRunningGeneration = generation;
  try {
    while (
      (previewQueue.length > 0 || detailPreviewQueue.length > 0 || vectorPreviewQueue.length > 0) &&
      currentDocument &&
      activeRequestId === requestId &&
      previewGeneration === generation &&
      !cancelledTasks.has("preview")
    ) {
      const vectorPageNumber = vectorPreviewQueue.shift();
      const detailRequest = vectorPageNumber ? undefined : detailPreviewQueue.shift();
      const pageNumber = vectorPageNumber ?? detailRequest?.pageNumber ?? previewQueue.shift();
      if (!pageNumber) continue;
      try {
        if (vectorPageNumber) {
          const svg = prepareSvgPreview(currentDocument.renderSvgPage(pageNumber), {
            removeGuides: removePreviewGuides,
            guideDetection: previewGuideDetection,
          });
          const page = currentDocument.info.pages[pageNumber - 1];
          if (!page) throw new Pdf2PltError("invalid-page", `找不到第 ${pageNumber} 页。`);
          respond({
            type: "vector-preview",
            requestId,
            pageNumber,
            width: page.width,
            height: page.height,
            svg,
          });
          await yieldControl();
          continue;
        }
        const preview = currentDocument.renderPreview(pageNumber, {
          maxLongEdge: detailRequest?.maxLongEdge ?? previewLongEdge,
          removeGuides: removePreviewGuides,
          guideDetection: previewGuideDetection,
        });
        if (detailRequest) {
          respond(
            {
              type: "detail-preview",
              requestId,
              pageNumber,
              maxLongEdge: detailRequest.maxLongEdge,
              width: preview.width,
              height: preview.height,
              bytes: preview.bytes,
            },
            [preview.bytes.buffer],
          );
        } else {
          previewCompleted.add(pageNumber);
          respond(
            {
              type: "preview",
              requestId,
              pageNumber,
              width: preview.width,
              height: preview.height,
              bytes: preview.bytes,
            },
            [preview.bytes.buffer],
          );
          respond({
            type: "progress",
            requestId,
            completed: previewCompleted.size,
            total: previewTargetCount,
          });
        }
      } catch (error) {
        if (vectorPageNumber) {
          respond({
            type: "vector-preview-error",
            requestId,
            pageNumber,
            ...serializeError(error),
          });
          await yieldControl();
          continue;
        }
        if (!detailRequest) throw error;
        respond({
          type: "detail-preview-error",
          requestId,
          pageNumber,
          maxLongEdge: detailRequest.maxLongEdge,
          ...serializeError(error),
        });
      }
      await yieldControl();
    }
    if (
      previewQueue.length === 0 &&
      detailPreviewQueue.length === 0 &&
      vectorPreviewQueue.length === 0 &&
      currentDocument &&
      activeRequestId === requestId &&
      previewGeneration === generation &&
      !cancelledTasks.has("preview")
    ) {
      respond({ type: "complete", requestId });
    }
  } catch (error) {
    if (activeRequestId !== requestId || previewGeneration !== generation) return;
    const serialized = serializeError(error);
    respond({ type: "error", requestId, ...serialized });
  } finally {
    if (previewRunningGeneration === generation) previewRunningGeneration = undefined;
    if (
      (previewQueue.length > 0 || detailPreviewQueue.length > 0 || vectorPreviewQueue.length > 0) &&
      activeRequestId === requestId &&
      previewGeneration === generation &&
      !cancelledTasks.has("preview")
    ) {
      void drainPreviewQueue(requestId, generation);
    }
  }
}

async function detectGuides(request: Extract<PdfWorkerRequest, { type: "detect-guides" }>) {
  try {
    if (!currentDocument) {
      throw new Pdf2PltError("document-not-open", "请先打开 PDF 再检测红线。");
    }
    cancelledTasks.delete("detection");
    const result = await currentDocument.detectGuidesAsync(request.options, {
      isCancelled: () =>
        cancelledTasks.has("detection") || activeRequestId !== request.requestId,
      onProgress(completed, total) {
        respond({ type: "detection-progress", requestId: request.requestId, completed, total });
      },
      yieldControl,
    });
    if (cancelledTasks.has("detection") || activeRequestId !== request.requestId) return;
    respond({ type: "guides", requestId: request.requestId, result });
  } catch (error) {
    if (cancelledTasks.has("detection") || activeRequestId !== request.requestId) return;
    const serialized = serializeError(error);
    respond({ type: "guides-error", requestId: request.requestId, ...serialized });
  }
}

async function renderLayoutSvgPreview(
  request: Extract<PdfWorkerRequest, { type: "request-layout-svg-preview" }>,
) {
  const generation = ++layoutPreviewGeneration;
  try {
    if (!currentDocument) {
      throw new Pdf2PltError("document-not-open", "请先打开 PDF 再生成全屏预览。");
    }
    const pageNumbers = [
      ...new Set(
        flattenLayout(request.layout).flatMap((cell) =>
          cell?.kind === "page" ? [cell.pageNumber] : [],
        ),
      ),
    ];
    const pages = [];
    for (const pageNumber of pageNumbers) {
      if (
        generation !== layoutPreviewGeneration ||
        request.requestId !== activeRequestId
      ) return;
      pages.push({
        pageNumber,
        svg: prepareSvgPreview(currentDocument.renderSvgPage(pageNumber), {
          removeGuides: request.removeGuides,
          guideDetection: request.guideDetection,
        }),
      });
      await yieldControl();
    }
    if (
      generation !== layoutPreviewGeneration ||
      request.requestId !== activeRequestId
    ) return;
    const result = buildCombinedSvg(
      pages,
      request.layout,
      currentDocument.info.pageSizePt,
      request.guides,
      { removeGuides: false, removeBackground: true, rotation: 0 },
    );
    respond({
      type: "layout-svg-preview",
      requestId: request.requestId,
      layoutPreviewRequestId: request.layoutPreviewRequestId,
      width: result.widthPt,
      height: result.heightPt,
      svg: result.svg,
    });
  } catch (error) {
    if (
      generation !== layoutPreviewGeneration ||
      request.requestId !== activeRequestId
    ) return;
    respond({
      type: "layout-svg-preview-error",
      requestId: request.requestId,
      layoutPreviewRequestId: request.layoutPreviewRequestId,
      ...serializeError(error),
    });
  }
}

async function exportVector(request: Extract<PdfWorkerRequest, { type: "export-vector" }>) {
  try {
    if (!currentDocument) {
      throw new Pdf2PltError("document-not-open", "请先打开 PDF 再导出矢量文件。");
    }
    cancelledTasks.delete("export");
    const pageNumbers = [
      ...new Set(
        flattenLayout(request.layout)
          .filter((cell) => cell?.kind === "page")
          .map((cell) => cell?.kind === "page" ? cell.pageNumber : 0),
      ),
    ];
    const pages = [];
    for (let index = 0; index < pageNumbers.length; index += 1) {
      if (cancelledTasks.has("export") || activeRequestId !== request.requestId) return;
      const pageNumber = pageNumbers[index];
      if (!pageNumber) continue;
      pages.push({ pageNumber, svg: currentDocument.renderSvgPage(pageNumber) });
      respond({
        type: "export-progress",
        requestId: request.requestId,
        completed: index + 1,
        total: pageNumbers.length,
      });
      await yieldControl();
    }
    if (cancelledTasks.has("export") || activeRequestId !== request.requestId) return;
    const result = buildCombinedSvg(
      pages,
      request.layout,
      currentDocument.info.pageSizePt,
      request.guides,
      request.svgOptions,
    );
    const pltResult = request.format === "plt"
      ? buildCorelPlt(result, request.pltOptions)
      : undefined;
    const bytes = new TextEncoder().encode(pltResult?.plt ?? result.svg);
    respond(
      {
        type: "vector-export",
        requestId: request.requestId,
        format: request.format,
        bytes,
        widthPt: result.widthPt,
        heightPt: result.heightPt,
        pageInstances: result.pageInstances,
        visibleObjects: result.visibleObjects,
        paths: pltResult?.paths ?? 0,
        segments: pltResult?.segments ?? 0,
        omittedImages: pltResult?.omittedImages ?? 0,
        warnings: pltResult?.warnings ?? [],
      },
      [bytes.buffer],
    );
  } catch (error) {
    if (cancelledTasks.has("export") || activeRequestId !== request.requestId) return;
    const serialized = serializeError(error);
    respond({ type: "export-error", requestId: request.requestId, ...serialized });
  }
}

worker.onmessage = async (event: MessageEvent<PdfWorkerRequest>) => {
  const request = event.data;

  if (request.type === "open") {
    activeRequestId = request.requestId;
    previewGeneration += 1;
    layoutPreviewGeneration += 1;
    currentDocument?.close();
    currentDocument = undefined;
    previewQueue = [];
    detailPreviewQueue = [];
    vectorPreviewQueue = [];
    previewCompleted = new Set();
    previewTargetCount = 0;
    previewLongEdge = request.previewLongEdge;
    removePreviewGuides = request.removePreviewGuides;
    previewGuideDetection = { ...request.previewGuideDetection };
    cancelledTasks.clear();

    try {
      const imported = await import("mupdf");
      if (activeRequestId !== request.requestId) return;
      currentDocument = await openMuPdfDocument(imported.default, request.bytes);
      respond({ type: "document", requestId: request.requestId, info: currentDocument.info });

      queuePreviews(request.previewPriority, true);
      void drainPreviewQueue(request.requestId, previewGeneration);

      const initialDetection = await currentDocument.detectGuidesAsync({}, {
        isCancelled: () =>
          cancelledTasks.has("detection") || activeRequestId !== request.requestId,
        onProgress(completed, total) {
          respond({ type: "detection-progress", requestId: request.requestId, completed, total });
        },
        yieldControl,
      });
      if (!cancelledTasks.has("detection") && activeRequestId === request.requestId) {
        respond({ type: "guides", requestId: request.requestId, result: initialDetection });
      }
    } catch (error) {
      if (activeRequestId !== request.requestId) return;
      if (error instanceof Pdf2PltError && error.code === "task-cancelled") return;
      currentDocument?.close();
      currentDocument = undefined;
      const serialized = serializeError(error);
      respond({ type: "error", requestId: request.requestId, ...serialized });
    }
    return;
  }

  if (request.type === "close") {
    activeRequestId = request.requestId;
    previewGeneration += 1;
    layoutPreviewGeneration += 1;
    previewQueue = [];
    detailPreviewQueue = [];
    vectorPreviewQueue = [];
    previewTargetCount = 0;
    cancelledTasks.add("preview");
    cancelledTasks.add("detection");
    cancelledTasks.add("export");
    currentDocument?.close();
    currentDocument = undefined;
    respond({ type: "complete", requestId: request.requestId });
    return;
  }

  if (request.requestId !== activeRequestId) return;

  if (request.type === "cancel-task") {
    cancelledTasks.add(request.task);
    if (request.task === "preview") {
      previewQueue = [];
      detailPreviewQueue = [];
      vectorPreviewQueue = [];
    }
    respond({ type: "task-cancelled", requestId: request.requestId, task: request.task });
    return;
  }

  if (request.type === "request-previews") {
    cancelledTasks.delete("preview");
    queuePreviews(request.pageNumbers, true);
    void drainPreviewQueue(request.requestId, previewGeneration);
    return;
  }

  if (request.type === "request-vector-previews") {
    cancelledTasks.delete("preview");
    queueVectorPreviews(request.pageNumbers);
    void drainPreviewQueue(request.requestId, previewGeneration);
    return;
  }

  if (request.type === "request-layout-svg-preview") {
    void renderLayoutSvgPreview(request);
    return;
  }

  if (request.type === "request-detail-previews") {
    cancelledTasks.delete("preview");
    queueDetailPreviews(
      request.pageNumbers,
      Math.max(previewLongEdge, Math.min(4096, Math.round(request.maxLongEdge))),
    );
    void drainPreviewQueue(request.requestId, previewGeneration);
    return;
  }

  if (request.type === "render-region") {
    try {
      if (!currentDocument) {
        throw new Pdf2PltError("document-not-open", "请先打开 PDF 再使用局部放大。");
      }
      const region = currentDocument.renderRegion(request.pageNumber, request.options);
      respond(
        {
          type: "region",
          requestId: request.requestId,
          regionRequestId: request.regionRequestId,
          pageNumber: request.pageNumber,
          width: region.width,
          height: region.height,
          bytes: region.bytes,
        },
        [region.bytes.buffer],
      );
    } catch (error) {
      const serialized = serializeError(error);
      respond({
        type: "region-error",
        requestId: request.requestId,
        regionRequestId: request.regionRequestId,
        ...serialized,
      });
    }
    return;
  }

  if (request.type === "configure-preview-guides") {
    previewGeneration += 1;
    layoutPreviewGeneration += 1;
    previewQueue = [];
    detailPreviewQueue = [];
    vectorPreviewQueue = [];
    previewCompleted = new Set();
    previewTargetCount = 0;
    removePreviewGuides = request.removeGuides;
    previewGuideDetection = { ...request.options };
    cancelledTasks.delete("preview");
    queuePreviews(request.pageNumbers, true);
    void drainPreviewQueue(request.requestId, previewGeneration);
    return;
  }

  if (request.type === "detect-guides") {
    await detectGuides(request);
    return;
  }

  if (request.type === "export-vector") {
    await exportVector(request);
  }
};
