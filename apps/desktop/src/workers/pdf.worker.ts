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
let currentDocument: OpenDocumentResult | undefined;
let activeRequestId = 0;

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

worker.onmessage = async (event: MessageEvent<PdfWorkerRequest>) => {
  const request = event.data;
  activeRequestId = request.requestId;

  if (request.type === "close") {
    currentDocument?.close();
    currentDocument = undefined;
    respond({ type: "complete", requestId: request.requestId });
    return;
  }

  if (request.type === "detect-guides") {
    try {
      if (!currentDocument) {
        throw new Pdf2PltError("document-not-open", "请先打开 PDF 再检测红线。");
      }
      respond({
        type: "guides",
        requestId: request.requestId,
        result: currentDocument.detectGuides(request.options),
      });
    } catch (error) {
      const serialized = serializeError(error);
      respond({ type: "guides-error", requestId: request.requestId, ...serialized });
    }
    return;
  }

  if (request.type === "export-svg") {
    try {
      if (!currentDocument) {
        throw new Pdf2PltError("document-not-open", "请先打开 PDF 再导出 SVG。");
      }
      const pageNumbers = [
        ...new Set(
          flattenLayout(request.layout)
            .filter((cell) => cell?.kind === "page")
            .map((cell) => cell?.kind === "page" ? cell.pageNumber : 0),
        ),
      ];
      const pages = [];
      for (let index = 0; index < pageNumbers.length; index += 1) {
        const pageNumber = pageNumbers[index];
        if (!pageNumber) continue;
        pages.push({ pageNumber, svg: currentDocument.renderSvgPage(pageNumber) });
        respond({
          type: "export-progress",
          requestId: request.requestId,
          completed: index + 1,
          total: pageNumbers.length,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
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
      const serialized = serializeError(error);
      respond({ type: "export-error", requestId: request.requestId, ...serialized });
    }
    return;
  }

  currentDocument?.close();
  currentDocument = undefined;

  try {
    const imported = await import("mupdf");
    if (activeRequestId !== request.requestId) return;

    currentDocument = await openMuPdfDocument(imported.default, request.bytes);
    respond({
      type: "document",
      requestId: request.requestId,
      info: currentDocument.info,
    });

    const guideDetection = currentDocument.detectGuides();
    respond({
      type: "guides",
      requestId: request.requestId,
      result: guideDetection,
    });

    for (let pageNumber = 1; pageNumber <= currentDocument.info.pageCount; pageNumber += 1) {
      if (activeRequestId !== request.requestId || !currentDocument) return;
      const preview = currentDocument.renderPreview(pageNumber, {
        maxLongEdge: request.previewLongEdge,
      });
      respond(
        {
          type: "preview",
          requestId: request.requestId,
          pageNumber,
          width: preview.width,
          height: preview.height,
          bytes: preview.bytes,
        },
        [preview.bytes.buffer],
      );
      respond({
        type: "progress",
        requestId: request.requestId,
        completed: pageNumber,
        total: currentDocument.info.pageCount,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    respond({ type: "complete", requestId: request.requestId });
  } catch (error) {
    currentDocument?.close();
    currentDocument = undefined;
    const serialized = serializeError(error);
    respond({
      type: "error",
      requestId: request.requestId,
      ...serialized,
    });
  }
};
