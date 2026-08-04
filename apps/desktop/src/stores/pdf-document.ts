import {
  DEFAULT_SVG_EXPORT_OPTIONS,
  type GuideCoordinates,
  type GuideDetectionResult,
  type LayoutGrid,
  type PdfDocumentInfo,
  type SvgExportOptions,
} from "@pdf2plt/core";
import { defineStore } from "pinia";
import { markRaw } from "vue";

import type { PdfWorkerRequest, PdfWorkerResponse } from "../workers/protocol";

export interface PreviewState {
  pageNumber: number;
  width: number;
  height: number;
  url: string;
}

type DocumentStatus = "idle" | "loading" | "ready" | "error";
type ExportStatus = "idle" | "running" | "complete" | "error";

export interface DesktopSvgExport {
  bytes: Uint8Array<ArrayBuffer>;
  widthPt: number;
  heightPt: number;
  pageInstances: number;
  visibleObjects: number;
}

let pendingExport:
  | { resolve(value: DesktopSvgExport): void; reject(reason: Error): void }
  | undefined;

export const usePdfDocumentStore = defineStore("pdf-document", {
  state: () => ({
    status: "idle" as DocumentStatus,
    fileName: "",
    sourcePath: undefined as string | undefined,
    info: undefined as PdfDocumentInfo | undefined,
    guideDetection: undefined as GuideDetectionResult | undefined,
    previews: {} as Record<number, PreviewState>,
    progress: { completed: 0, total: 0 },
    errorMessage: "",
    exportStatus: "idle" as ExportStatus,
    exportProgress: { completed: 0, total: 0 },
    exportSummary: undefined as Omit<DesktopSvgExport, "bytes"> | undefined,
    exportErrorMessage: "",
    worker: undefined as Worker | undefined,
    requestId: 0,
  }),
  getters: {
    previewList(state): PreviewState[] {
      return Object.values(state.previews).sort((a, b) => a.pageNumber - b.pageNumber);
    },
  },
  actions: {
    ensureWorker() {
      if (this.worker) return;
      this.worker = markRaw(
        new Worker(new URL("../workers/pdf.worker.ts", import.meta.url), {
          type: "module",
        }),
      );
      this.worker.onmessage = (event: MessageEvent<PdfWorkerResponse>) => {
        this.handleWorkerMessage(event.data);
      };
      this.worker.onerror = (event) => {
        if (this.exportStatus === "running") {
          this.exportStatus = "error";
          this.exportErrorMessage = event.message || "SVG 导出 Worker 发生错误。";
          pendingExport?.reject(new Error(this.exportErrorMessage));
          pendingExport = undefined;
          return;
        }
        this.status = "error";
        this.errorMessage = event.message || "PDF Worker 启动失败。";
      };
    },
    async open(bytes: Uint8Array<ArrayBuffer>, fileName: string, sourcePath?: string) {
      this.disposePreviews();
      this.ensureWorker();
      this.requestId += 1;
      this.status = "loading";
      this.fileName = fileName;
      this.sourcePath = sourcePath;
      this.info = undefined;
      this.guideDetection = undefined;
      this.errorMessage = "";
      this.progress = { completed: 0, total: 0 };
      this.resetExport();
      const request: PdfWorkerRequest = {
        type: "open",
        requestId: this.requestId,
        bytes,
        previewLongEdge: 1600,
      };
      this.worker?.postMessage(request, [bytes.buffer]);
    },
    handleWorkerMessage(message: PdfWorkerResponse) {
      if (message.requestId !== this.requestId) return;
      if (message.type === "document") {
        this.info = message.info;
        this.progress = { completed: 0, total: message.info.pageCount };
        return;
      }
      if (message.type === "preview") {
        const blob = new Blob([message.bytes], { type: "image/png" });
        this.previews[message.pageNumber] = {
          pageNumber: message.pageNumber,
          width: message.width,
          height: message.height,
          url: URL.createObjectURL(blob),
        };
        return;
      }
      if (message.type === "guides") {
        this.guideDetection = message.result;
        return;
      }
      if (message.type === "progress") {
        this.progress = { completed: message.completed, total: message.total };
        return;
      }
      if (message.type === "export-progress") {
        this.exportProgress = { completed: message.completed, total: message.total };
        return;
      }
      if (message.type === "svg-export") {
        const result: DesktopSvgExport = {
          bytes: message.bytes,
          widthPt: message.widthPt,
          heightPt: message.heightPt,
          pageInstances: message.pageInstances,
          visibleObjects: message.visibleObjects,
        };
        this.exportStatus = "complete";
        this.exportSummary = {
          widthPt: result.widthPt,
          heightPt: result.heightPt,
          pageInstances: result.pageInstances,
          visibleObjects: result.visibleObjects,
        };
        pendingExport?.resolve(result);
        pendingExport = undefined;
        return;
      }
      if (message.type === "export-error") {
        this.exportStatus = "error";
        this.exportErrorMessage = message.message;
        pendingExport?.reject(new Error(message.message));
        pendingExport = undefined;
        return;
      }
      if (message.type === "complete") {
        if (this.info) this.status = "ready";
        return;
      }
      this.status = "error";
      this.errorMessage = message.message;
    },
    close() {
      this.requestId += 1;
      const request: PdfWorkerRequest = { type: "close", requestId: this.requestId };
      this.worker?.postMessage(request);
      this.disposePreviews();
      this.status = "idle";
      this.fileName = "";
      this.sourcePath = undefined;
      this.info = undefined;
      this.guideDetection = undefined;
      this.errorMessage = "";
      this.progress = { completed: 0, total: 0 };
      this.resetExport();
    },
    disposePreviews() {
      for (const preview of Object.values(this.previews)) {
        URL.revokeObjectURL(preview.url);
      }
      this.previews = {};
    },
    exportSvg(
      layout: LayoutGrid,
      guides: GuideCoordinates | undefined,
      overrides: Partial<SvgExportOptions> = {},
    ): Promise<DesktopSvgExport> {
      if (!this.worker || !this.info) return Promise.reject(new Error("请先打开 PDF。"));
      if (pendingExport) return Promise.reject(new Error("已有 SVG 导出任务正在进行。"));
      this.exportStatus = "running";
      this.exportProgress = { completed: 0, total: this.info.pageCount };
      this.exportSummary = undefined;
      this.exportErrorMessage = "";
      const request: PdfWorkerRequest = {
        type: "export-svg",
        requestId: this.requestId,
        layout: JSON.parse(JSON.stringify(layout)) as LayoutGrid,
        guides: guides ? { ...guides } : undefined,
        options: { ...DEFAULT_SVG_EXPORT_OPTIONS, ...overrides },
      };
      return new Promise<DesktopSvgExport>((resolve, reject) => {
        pendingExport = { resolve, reject };
        this.worker?.postMessage(request);
      });
    },
    resetExport() {
      pendingExport?.reject(new Error("SVG 导出已取消。"));
      pendingExport = undefined;
      this.exportStatus = "idle";
      this.exportProgress = { completed: 0, total: 0 };
      this.exportSummary = undefined;
      this.exportErrorMessage = "";
    },
    dispose() {
      this.close();
      this.worker?.terminate();
      this.worker = undefined;
    },
  },
});
