import {
  DEFAULT_SVG_EXPORT_OPTIONS,
  type GuideCoordinates,
  type GuideDetectionOptions,
  type GuideDetectionResult,
  type LayoutGrid,
  type PdfDocumentInfo,
  type SvgExportOptions,
} from "@pdf2plt/core";
import { defineStore } from "pinia";
import { markRaw } from "vue";

import type { PdfWorkerRequest, PdfWorkerResponse } from "../workers/protocol";
import { sha256Hex } from "../project/fingerprint";

export interface PreviewState {
  pageNumber: number;
  width: number;
  height: number;
  url: string;
}

type DocumentStatus = "idle" | "loading" | "ready" | "error";
type ExportStatus = "idle" | "running" | "complete" | "cancelled" | "error";
type DetectionStatus = "idle" | "running" | "cancelled" | "error";

export const MAX_PREVIEW_CACHE = 18;

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
let pendingDetection:
  | { resolve(value: GuideDetectionResult): void; reject(reason: Error): void }
  | undefined;

export const usePdfDocumentStore = defineStore("pdf-document", {
  state: () => ({
    status: "idle" as DocumentStatus,
    fileName: "",
    sourcePath: undefined as string | undefined,
    info: undefined as PdfDocumentInfo | undefined,
    guideDetection: undefined as GuideDetectionResult | undefined,
    detectionStatus: "idle" as DetectionStatus,
    detectionProgress: { completed: 0, total: 0 },
    detectionErrorMessage: "",
    sourceSha256: "",
    previews: {} as Record<number, PreviewState>,
    previewOrder: [] as number[],
    visiblePreviewPages: [] as number[],
    previewStatus: "idle" as "idle" | "running" | "complete" | "cancelled",
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
        if (this.detectionStatus === "running") {
          this.detectionStatus = "error";
          this.detectionErrorMessage = event.message || "红线检测 Worker 发生错误。";
          pendingDetection?.reject(new Error(this.detectionErrorMessage));
          pendingDetection = undefined;
          return;
        }
        this.status = "error";
        this.errorMessage = event.message || "PDF Worker 启动失败。";
      };
    },
    async open(bytes: Uint8Array<ArrayBuffer>, fileName: string, sourcePath?: string) {
      pendingDetection?.reject(new Error("红线检测已取消。"));
      pendingDetection = undefined;
      this.disposePreviews();
      this.ensureWorker();
      this.requestId += 1;
      this.status = "loading";
      this.fileName = fileName;
      this.sourcePath = sourcePath;
      this.info = undefined;
      this.guideDetection = undefined;
      this.sourceSha256 = await sha256Hex(bytes);
      this.errorMessage = "";
      this.progress = { completed: 0, total: 0 };
      this.previewStatus = "running";
      this.detectionStatus = "running";
      this.detectionProgress = { completed: 0, total: 0 };
      this.detectionErrorMessage = "";
      this.resetExport();
      const request: PdfWorkerRequest = {
        type: "open",
        requestId: this.requestId,
        bytes,
        previewLongEdge: 1600,
        previewPriority: [1, 2, 3],
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
        const previous = this.previews[message.pageNumber];
        if (previous) URL.revokeObjectURL(previous.url);
        this.previews[message.pageNumber] = {
          pageNumber: message.pageNumber,
          width: message.width,
          height: message.height,
          url: URL.createObjectURL(blob),
        };
        this.touchPreview(message.pageNumber);
        this.evictPreviewCache();
        return;
      }
      if (message.type === "guides") {
        this.guideDetection = message.result;
        this.detectionStatus = "idle";
        this.detectionProgress = {
          completed: message.result.options ? this.info?.pageCount ?? 0 : 0,
          total: this.info?.pageCount ?? 0,
        };
        this.detectionErrorMessage = "";
        pendingDetection?.resolve(message.result);
        pendingDetection = undefined;
        return;
      }
      if (message.type === "guides-error") {
        this.detectionStatus = "error";
        this.detectionErrorMessage = message.message;
        pendingDetection?.reject(new Error(message.message));
        pendingDetection = undefined;
        return;
      }
      if (message.type === "detection-progress") {
        this.detectionProgress = { completed: message.completed, total: message.total };
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
        if (this.info) {
          this.status = "ready";
          this.previewStatus = "complete";
        }
        return;
      }
      if (message.type === "task-cancelled") {
        if (message.task === "preview") {
          this.previewStatus = "cancelled";
          if (this.info) this.status = "ready";
        } else if (message.task === "detection") {
          this.detectionStatus = "cancelled";
          pendingDetection?.reject(new Error("红线检测已取消。"));
          pendingDetection = undefined;
        } else {
          this.exportStatus = "cancelled";
          pendingExport?.reject(new Error("SVG 导出已取消。"));
          pendingExport = undefined;
        }
        return;
      }
      this.status = "error";
      this.errorMessage = message.message;
    },
    close() {
      pendingDetection?.reject(new Error("红线检测已取消。"));
      pendingDetection = undefined;
      this.requestId += 1;
      const request: PdfWorkerRequest = { type: "close", requestId: this.requestId };
      this.worker?.postMessage(request);
      this.disposePreviews();
      this.status = "idle";
      this.fileName = "";
      this.sourcePath = undefined;
      this.info = undefined;
      this.guideDetection = undefined;
      this.detectionStatus = "idle";
      this.detectionProgress = { completed: 0, total: 0 };
      this.detectionErrorMessage = "";
      this.sourceSha256 = "";
      this.errorMessage = "";
      this.progress = { completed: 0, total: 0 };
      this.previewStatus = "idle";
      this.resetExport();
    },
    disposePreviews() {
      for (const preview of Object.values(this.previews)) {
        URL.revokeObjectURL(preview.url);
      }
      this.previews = {};
      this.previewOrder = [];
      this.visiblePreviewPages = [];
    },
    touchPreview(pageNumber: number) {
      this.previewOrder = [
        ...this.previewOrder.filter((value) => value !== pageNumber),
        pageNumber,
      ];
    },
    evictPreviewCache() {
      while (Object.keys(this.previews).length > MAX_PREVIEW_CACHE) {
        const candidateIndex = this.previewOrder.findIndex(
          (pageNumber) => !this.visiblePreviewPages.includes(pageNumber),
        );
        if (candidateIndex < 0) return;
        const [pageNumber] = this.previewOrder.splice(candidateIndex, 1);
        if (!pageNumber) return;
        const preview = this.previews[pageNumber];
        if (preview) URL.revokeObjectURL(preview.url);
        delete this.previews[pageNumber];
      }
    },
    prioritizePreviews(pageNumbers: number[]) {
      if (!this.worker || !this.info) return;
      const visible = [...new Set(pageNumbers)]
        .filter((pageNumber) => pageNumber >= 1 && pageNumber <= this.info!.pageCount)
        .slice(0, MAX_PREVIEW_CACHE);
      this.visiblePreviewPages = visible;
      for (const pageNumber of visible) {
        if (this.previews[pageNumber]) this.touchPreview(pageNumber);
      }
      this.evictPreviewCache();
      const missing = visible.filter((pageNumber) => !this.previews[pageNumber]);
      if (missing.length === 0) return;
      this.previewStatus = "running";
      this.worker.postMessage({
        type: "request-previews",
        requestId: this.requestId,
        pageNumbers: missing,
      } satisfies PdfWorkerRequest);
    },
    cancelPreview() {
      if (!this.worker || this.previewStatus !== "running") return;
      this.worker.postMessage({
        type: "cancel-task",
        requestId: this.requestId,
        task: "preview",
      } satisfies PdfWorkerRequest);
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
    detectGuides(options: GuideDetectionOptions): Promise<GuideDetectionResult> {
      if (!this.worker || !this.info) return Promise.reject(new Error("请先打开 PDF。"));
      if (pendingDetection) return Promise.reject(new Error("红线检测已在进行中。"));
      this.detectionStatus = "running";
      this.detectionErrorMessage = "";
      this.detectionProgress = { completed: 0, total: this.info.pageCount };
      const request: PdfWorkerRequest = {
        type: "detect-guides",
        requestId: this.requestId,
        options: { ...options },
      };
      return new Promise<GuideDetectionResult>((resolve, reject) => {
        pendingDetection = { resolve, reject };
        this.worker?.postMessage(request);
      });
    },
    cancelDetection() {
      if (!this.worker || this.detectionStatus !== "running") return;
      this.worker.postMessage({
        type: "cancel-task",
        requestId: this.requestId,
        task: "detection",
      } satisfies PdfWorkerRequest);
    },
    cancelExport() {
      if (!this.worker || this.exportStatus !== "running") return;
      this.worker.postMessage({
        type: "cancel-task",
        requestId: this.requestId,
        task: "export",
      } satisfies PdfWorkerRequest);
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
