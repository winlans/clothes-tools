/// <reference lib="webworker" />

import {
  buildCombinedSvg,
  flattenLayout,
  openMuPdfDocument,
  Pdf2PltError,
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
let previewQueue: number[] = [];
let previewCompleted = new Set<number>();
let previewTargetCount = 0;
let previewGeneration = 0;
let previewRunningGeneration: number | undefined;
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

async function drainPreviewQueue(requestId: number, generation: number) {
  if (previewRunningGeneration === generation) return;
  previewRunningGeneration = generation;
  try {
    while (
      previewQueue.length > 0 &&
      currentDocument &&
      activeRequestId === requestId &&
      previewGeneration === generation &&
      !cancelledTasks.has("preview")
    ) {
      const pageNumber = previewQueue.shift();
      if (!pageNumber) continue;
      const preview = currentDocument.renderPreview(pageNumber, {
        maxLongEdge: previewLongEdge,
      });
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
      await yieldControl();
    }
    if (
      previewQueue.length === 0 &&
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
      previewQueue.length > 0 &&
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

async function exportSvg(request: Extract<PdfWorkerRequest, { type: "export-svg" }>) {
  try {
    if (!currentDocument) {
      throw new Pdf2PltError("document-not-open", "请先打开 PDF 再导出 SVG。");
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
      request.options,
    );
    const bytes = new TextEncoder().encode(result.svg);
    respond(
      {
        type: "svg-export",
        requestId: request.requestId,
        bytes,
        widthPt: result.widthPt,
        heightPt: result.heightPt,
        pageInstances: result.pageInstances,
        visibleObjects: result.visibleObjects,
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
    currentDocument?.close();
    currentDocument = undefined;
    previewQueue = [];
    previewCompleted = new Set();
    previewTargetCount = 0;
    previewLongEdge = request.previewLongEdge;
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
    previewQueue = [];
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
    if (request.task === "preview") previewQueue = [];
    respond({ type: "task-cancelled", requestId: request.requestId, task: request.task });
    return;
  }

  if (request.type === "request-previews") {
    cancelledTasks.delete("preview");
    queuePreviews(request.pageNumbers, true);
    void drainPreviewQueue(request.requestId, previewGeneration);
    return;
  }

  if (request.type === "detect-guides") {
    await detectGuides(request);
    return;
  }

  if (request.type === "export-svg") {
    await exportSvg(request);
  }
};
