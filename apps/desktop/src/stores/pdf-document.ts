import {
  DEFAULT_GUIDE_DETECTION_OPTIONS,
  DEFAULT_PLT_EXPORT_OPTIONS,
  DEFAULT_SVG_EXPORT_OPTIONS,
  type GuideCoordinates,
  type GuideDetectionOptions,
  type GuideDetectionResult,
  type LayoutGrid,
  type PdfDocumentInfo,
  type PdfRegionRenderOptions,
  type PltExportOptions,
  type SvgExportOptions,
} from "@pdf2plt/core";
import { defineStore } from "pinia";
import { markRaw } from "vue";

import type {
  PdfWorkerRequest,
  PdfWorkerResponse,
  VectorExportFormat,
} from "../workers/protocol";
import { sha256Hex } from "../project/fingerprint";

export interface PreviewState {
  pageNumber: number;
  width: number;
  height: number;
  url: string;
  format?: "raster" | "svg";
}

interface DetailPreviewState extends PreviewState {
  maxLongEdge: number;
}

type DocumentStatus = "idle" | "loading" | "ready" | "error";
type ExportStatus = "idle" | "running" | "complete" | "cancelled" | "error";
type DetectionStatus = "idle" | "running" | "cancelled" | "error";
type LayoutSvgPreviewStatus = "idle" | "running" | "ready" | "error";

export const MAX_PREVIEW_CACHE = 18;
export const MAX_DETAIL_PREVIEW_CACHE = 4;
export const MAX_VECTOR_PREVIEW_CACHE = 24;
const MAX_DETAIL_PREVIEW_LONG_EDGE = 4096;

export interface DesktopVectorExport {
  format: VectorExportFormat;
  bytes: Uint8Array<ArrayBuffer>;
  widthPt: number;
  heightPt: number;
  pageInstances: number;
  visibleObjects: number;
  paths: number;
  segments: number;
  omittedImages: number;
  warnings: string[];
}

export type DesktopSvgExport = DesktopVectorExport;

export interface DesktopPdfRegion {
  pageNumber: number;
  width: number;
  height: number;
  bytes: Uint8Array<ArrayBuffer>;
}

type PendingExport = { resolve(value: DesktopVectorExport): void; reject(reason: Error): void };
type PendingDetection = {
  resolve(value: GuideDetectionResult): void;
  reject(reason: Error): void;
};

const pendingExports = new WeakMap<object, PendingExport>();
const pendingDetections = new WeakMap<object, PendingDetection>();
const pendingRegions = new WeakMap<
  object,
  Map<number, { resolve(value: DesktopPdfRegion): void; reject(reason: Error): void }>
>();

function rejectPendingRegions(store: object, message: string) {
  const pending = pendingRegions.get(store);
  if (!pending) return;
  for (const request of pending.values()) request.reject(new Error(message));
  pending.clear();
}

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
    detailPreviews: {} as Record<number, DetailPreviewState>,
    vectorPreviews: {} as Record<number, PreviewState>,
    detailPreviewOrder: [] as number[],
    vectorPreviewOrder: [] as number[],
    pendingDetailPreviewEdges: {} as Record<number, number>,
    pendingVectorPreviewPages: {} as Record<number, true>,
    vectorPreviewFailures: {} as Record<number, true>,
    layoutSvgPreview: undefined as PreviewState | undefined,
    layoutSvgPreviewStatus: "idle" as LayoutSvgPreviewStatus,
    layoutSvgPreviewError: "",
    previewOrder: [] as number[],
    visiblePreviewPages: [] as number[],
    previewCacheLimit: MAX_PREVIEW_CACHE,
    previewRemoveGuides: true,
    previewGuideDetection: { ...DEFAULT_GUIDE_DETECTION_OPTIONS } as GuideDetectionOptions,
    previewStatus: "idle" as "idle" | "running" | "complete" | "cancelled",
    progress: { completed: 0, total: 0 },
    errorMessage: "",
    exportStatus: "idle" as ExportStatus,
    exportProgress: { completed: 0, total: 0 },
    exportSummary: undefined as Omit<DesktopVectorExport, "bytes"> | undefined,
    exportErrorMessage: "",
    worker: undefined as Worker | undefined,
    requestId: 0,
    regionRequestId: 0,
    layoutPreviewRequestId: 0,
  }),
  getters: {
    previewList(state): PreviewState[] {
      return Object.values({
        ...state.previews,
        ...state.detailPreviews,
        ...state.vectorPreviews,
      })
        .sort((a, b) => a.pageNumber - b.pageNumber);
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
        rejectPendingRegions(this, event.message || "局部放大 Worker 发生错误。");
        if (this.exportStatus === "running") {
          this.exportStatus = "error";
          this.exportErrorMessage = event.message || "矢量导出 Worker 发生错误。";
          pendingExports.get(this)?.reject(new Error(this.exportErrorMessage));
          pendingExports.delete(this);
          return;
        }
        if (this.detectionStatus === "running") {
          this.detectionStatus = "error";
          this.detectionErrorMessage = event.message || "红线检测 Worker 发生错误。";
          pendingDetections.get(this)?.reject(new Error(this.detectionErrorMessage));
          pendingDetections.delete(this);
          return;
        }
        this.status = "error";
        this.errorMessage = event.message || "PDF Worker 启动失败。";
      };
    },
    async open(bytes: Uint8Array<ArrayBuffer>, fileName: string, sourcePath?: string) {
      rejectPendingRegions(this, "PDF 已切换，局部放大已取消。");
      pendingDetections.get(this)?.reject(new Error("红线检测已取消。"));
      pendingDetections.delete(this);
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
        removePreviewGuides: this.previewRemoveGuides,
        previewGuideDetection: { ...this.previewGuideDetection },
      };
      this.worker?.postMessage(request, [bytes.buffer]);
    },
    handleWorkerMessage(message: PdfWorkerResponse) {
      if (message.requestId !== this.requestId) return;
      if (message.type === "document") {
        this.info = message.info;
        this.progress = { completed: 0, total: Math.min(3, message.info.pageCount) };
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
      if (message.type === "vector-preview") {
        delete this.pendingVectorPreviewPages[message.pageNumber];
        delete this.vectorPreviewFailures[message.pageNumber];
        const previous = this.vectorPreviews[message.pageNumber];
        const blob = new Blob([message.svg], { type: "image/svg+xml;charset=utf-8" });
        if (previous) URL.revokeObjectURL(previous.url);
        this.vectorPreviews[message.pageNumber] = {
          pageNumber: message.pageNumber,
          width: message.width,
          height: message.height,
          url: URL.createObjectURL(blob),
          format: "svg",
        };
        this.touchVectorPreview(message.pageNumber);
        this.evictVectorPreviewCache();
        return;
      }
      if (message.type === "vector-preview-error") {
        delete this.pendingVectorPreviewPages[message.pageNumber];
        this.vectorPreviewFailures[message.pageNumber] = true;
        return;
      }
      if (message.type === "layout-svg-preview") {
        if (message.layoutPreviewRequestId !== this.layoutPreviewRequestId) return;
        const blob = new Blob([message.svg], { type: "image/svg+xml;charset=utf-8" });
        if (this.layoutSvgPreview) URL.revokeObjectURL(this.layoutSvgPreview.url);
        this.layoutSvgPreview = {
          pageNumber: 0,
          width: message.width,
          height: message.height,
          url: URL.createObjectURL(blob),
          format: "svg",
        };
        this.layoutSvgPreviewStatus = "ready";
        this.layoutSvgPreviewError = "";
        return;
      }
      if (message.type === "layout-svg-preview-error") {
        if (message.layoutPreviewRequestId !== this.layoutPreviewRequestId) return;
        this.layoutSvgPreviewStatus = "error";
        this.layoutSvgPreviewError = message.message;
        return;
      }
      if (message.type === "detail-preview") {
        const pendingEdge = this.pendingDetailPreviewEdges[message.pageNumber];
        if (pendingEdge !== undefined && message.maxLongEdge >= pendingEdge) {
          delete this.pendingDetailPreviewEdges[message.pageNumber];
        }
        const previous = this.detailPreviews[message.pageNumber];
        if (previous && previous.maxLongEdge > message.maxLongEdge) return;
        const blob = new Blob([message.bytes], { type: "image/png" });
        if (previous) URL.revokeObjectURL(previous.url);
        this.detailPreviews[message.pageNumber] = {
          pageNumber: message.pageNumber,
          width: message.width,
          height: message.height,
          maxLongEdge: message.maxLongEdge,
          url: URL.createObjectURL(blob),
        };
        this.touchDetailPreview(message.pageNumber);
        this.evictDetailPreviewCache();
        return;
      }
      if (message.type === "detail-preview-error") {
        const pendingEdge = this.pendingDetailPreviewEdges[message.pageNumber];
        if (pendingEdge !== undefined && message.maxLongEdge >= pendingEdge) {
          delete this.pendingDetailPreviewEdges[message.pageNumber];
        }
        return;
      }
      if (message.type === "region") {
        const pending = pendingRegions.get(this)?.get(message.regionRequestId);
        if (!pending) return;
        pendingRegions.get(this)?.delete(message.regionRequestId);
        pending.resolve({
          pageNumber: message.pageNumber,
          width: message.width,
          height: message.height,
          bytes: message.bytes,
        });
        return;
      }
      if (message.type === "region-error") {
        const pending = pendingRegions.get(this)?.get(message.regionRequestId);
        if (!pending) return;
        pendingRegions.get(this)?.delete(message.regionRequestId);
        pending.reject(new Error(message.message));
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
        pendingDetections.get(this)?.resolve(message.result);
        pendingDetections.delete(this);
        return;
      }
      if (message.type === "guides-error") {
        this.detectionStatus = "error";
        this.detectionErrorMessage = message.message;
        pendingDetections.get(this)?.reject(new Error(message.message));
        pendingDetections.delete(this);
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
      if (message.type === "vector-export") {
        const result: DesktopVectorExport = {
          format: message.format,
          bytes: message.bytes,
          widthPt: message.widthPt,
          heightPt: message.heightPt,
          pageInstances: message.pageInstances,
          visibleObjects: message.visibleObjects,
          paths: message.paths,
          segments: message.segments,
          omittedImages: message.omittedImages,
          warnings: message.warnings,
        };
        this.exportStatus = "complete";
        this.exportSummary = {
          format: result.format,
          widthPt: result.widthPt,
          heightPt: result.heightPt,
          pageInstances: result.pageInstances,
          visibleObjects: result.visibleObjects,
          paths: result.paths,
          segments: result.segments,
          omittedImages: result.omittedImages,
          warnings: result.warnings,
        };
        pendingExports.get(this)?.resolve(result);
        pendingExports.delete(this);
        return;
      }
      if (message.type === "export-error") {
        this.exportStatus = "error";
        this.exportErrorMessage = message.message;
        pendingExports.get(this)?.reject(new Error(message.message));
        pendingExports.delete(this);
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
          this.pendingDetailPreviewEdges = {};
          this.pendingVectorPreviewPages = {};
          if (this.info) this.status = "ready";
        } else if (message.task === "detection") {
          this.detectionStatus = "cancelled";
          pendingDetections.get(this)?.reject(new Error("红线检测已取消。"));
          pendingDetections.delete(this);
        } else {
          this.exportStatus = "cancelled";
          pendingExports.get(this)?.reject(new Error("矢量导出已取消。"));
          pendingExports.delete(this);
        }
        return;
      }
      this.status = "error";
      this.errorMessage = message.message;
    },
    close() {
      rejectPendingRegions(this, "局部放大已取消。");
      pendingDetections.get(this)?.reject(new Error("红线检测已取消。"));
      pendingDetections.delete(this);
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
      this.disposeDetailPreviews();
      this.disposeVectorPreviews();
      this.disposeLayoutSvgPreview();
    },
    disposeDetailPreviews() {
      for (const preview of Object.values(this.detailPreviews)) {
        URL.revokeObjectURL(preview.url);
      }
      this.detailPreviews = {};
      this.detailPreviewOrder = [];
      this.pendingDetailPreviewEdges = {};
    },
    disposeVectorPreviews() {
      for (const preview of Object.values(this.vectorPreviews)) {
        URL.revokeObjectURL(preview.url);
      }
      this.vectorPreviews = {};
      this.vectorPreviewOrder = [];
      this.pendingVectorPreviewPages = {};
      this.vectorPreviewFailures = {};
    },
    disposeLayoutSvgPreview() {
      if (this.layoutSvgPreview) URL.revokeObjectURL(this.layoutSvgPreview.url);
      this.layoutSvgPreview = undefined;
      this.layoutSvgPreviewStatus = "idle";
      this.layoutSvgPreviewError = "";
    },
    touchPreview(pageNumber: number) {
      this.previewOrder = [
        ...this.previewOrder.filter((value) => value !== pageNumber),
        pageNumber,
      ];
    },
    touchDetailPreview(pageNumber: number) {
      this.detailPreviewOrder = [
        ...this.detailPreviewOrder.filter((value) => value !== pageNumber),
        pageNumber,
      ];
    },
    touchVectorPreview(pageNumber: number) {
      this.vectorPreviewOrder = [
        ...this.vectorPreviewOrder.filter((value) => value !== pageNumber),
        pageNumber,
      ];
    },
    evictDetailPreviewCache() {
      while (Object.keys(this.detailPreviews).length > MAX_DETAIL_PREVIEW_CACHE) {
        const pageNumber = this.detailPreviewOrder.shift();
        if (!pageNumber) return;
        const preview = this.detailPreviews[pageNumber];
        if (preview) URL.revokeObjectURL(preview.url);
        delete this.detailPreviews[pageNumber];
      }
    },
    evictVectorPreviewCache() {
      while (Object.keys(this.vectorPreviews).length > MAX_VECTOR_PREVIEW_CACHE) {
        const pageNumber = this.vectorPreviewOrder.shift();
        if (!pageNumber) return;
        const preview = this.vectorPreviews[pageNumber];
        if (preview) URL.revokeObjectURL(preview.url);
        delete this.vectorPreviews[pageNumber];
      }
    },
    evictPreviewCache() {
      while (Object.keys(this.previews).length > this.previewCacheLimit) {
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
    setPreviewCacheLimit(limit: number) {
      const maximum = Math.max(MAX_PREVIEW_CACHE, this.info?.pageCount ?? MAX_PREVIEW_CACHE);
      this.previewCacheLimit = Math.max(1, Math.min(maximum, Math.floor(limit)));
      if (this.previewCacheLimit < MAX_PREVIEW_CACHE) this.visiblePreviewPages = [];
      this.evictPreviewCache();
    },
    setPreviewGuideRemoval(removeGuides: boolean, options: GuideDetectionOptions) {
      const nextOptions = { ...options };
      const optionsChanged = (
        Object.keys(nextOptions) as Array<keyof GuideDetectionOptions>
      ).some((key) => nextOptions[key] !== this.previewGuideDetection[key]);
      if (removeGuides === this.previewRemoveGuides && !optionsChanged) return;

      this.previewRemoveGuides = removeGuides;
      this.previewGuideDetection = nextOptions;
      this.disposeDetailPreviews();
      this.disposeVectorPreviews();
      this.disposeLayoutSvgPreview();
      if (!this.worker || !this.info) return;

      const pageNumbers = [...new Set([
        ...this.visiblePreviewPages,
        ...this.previewOrder,
      ])].slice(0, this.previewCacheLimit);
      if (pageNumbers.length === 0) {
        pageNumbers.push(
          ...this.info.pages
            .slice(0, Math.min(3, this.previewCacheLimit))
            .map((page) => page.pageNumber),
        );
      }
      for (const preview of Object.values(this.previews)) {
        URL.revokeObjectURL(preview.url);
      }
      this.previews = {};
      this.previewOrder = [];
      this.visiblePreviewPages = pageNumbers;
      this.previewStatus = "running";
      this.progress = { completed: 0, total: pageNumbers.length };
      this.worker.postMessage({
        type: "configure-preview-guides",
        requestId: this.requestId,
        removeGuides,
        options: nextOptions,
        pageNumbers,
      } satisfies PdfWorkerRequest);
    },
    prioritizePreviews(pageNumbers: number[]) {
      if (!this.worker || !this.info) return;
      const visible = [...new Set(pageNumbers)]
        .filter((pageNumber) => pageNumber >= 1 && pageNumber <= this.info!.pageCount)
        .slice(0, this.previewCacheLimit);
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
    requestDetailPreviews(pageNumbers: number[], maxLongEdge: number) {
      if (!this.worker || !this.info) return;
      const targetEdge = Math.max(
        1601,
        Math.min(MAX_DETAIL_PREVIEW_LONG_EDGE, Math.round(maxLongEdge)),
      );
      const visible = [...new Set(pageNumbers)]
        .filter((pageNumber) => pageNumber >= 1 && pageNumber <= this.info!.pageCount)
        .slice(0, MAX_DETAIL_PREVIEW_CACHE);
      const missing = visible.filter((pageNumber) => {
        const existingEdge = this.detailPreviews[pageNumber]?.maxLongEdge ?? 0;
        const pendingEdge = this.pendingDetailPreviewEdges[pageNumber] ?? 0;
        if (existingEdge >= targetEdge) {
          this.touchDetailPreview(pageNumber);
          return false;
        }
        if (pendingEdge >= targetEdge) return false;
        this.pendingDetailPreviewEdges[pageNumber] = targetEdge;
        return true;
      });
      this.evictDetailPreviewCache();
      if (missing.length === 0) return;
      this.worker.postMessage({
        type: "request-detail-previews",
        requestId: this.requestId,
        pageNumbers: missing,
        maxLongEdge: targetEdge,
      } satisfies PdfWorkerRequest);
    },
    requestVectorPreviews(pageNumbers: number[]) {
      if (!this.worker || !this.info) return;
      const visible = [...new Set(pageNumbers)]
        .filter((pageNumber) => pageNumber >= 1 && pageNumber <= this.info!.pageCount)
        .slice(0, MAX_VECTOR_PREVIEW_CACHE);
      const missing = visible.filter((pageNumber) => {
        if (this.vectorPreviews[pageNumber]) {
          this.touchVectorPreview(pageNumber);
          return false;
        }
        if (
          this.pendingVectorPreviewPages[pageNumber] ||
          this.vectorPreviewFailures[pageNumber]
        ) return false;
        this.pendingVectorPreviewPages[pageNumber] = true;
        return true;
      });
      this.evictVectorPreviewCache();
      if (missing.length === 0) return;
      this.worker.postMessage({
        type: "request-vector-previews",
        requestId: this.requestId,
        pageNumbers: missing,
      } satisfies PdfWorkerRequest);
    },
    requestCanvasPreviews(pageNumbers: number[], maxLongEdge?: number) {
      this.requestVectorPreviews(pageNumbers);
      if (!maxLongEdge) return;
      const rasterFallbackPages = pageNumbers.filter(
        (pageNumber) => this.vectorPreviewFailures[pageNumber],
      );
      if (rasterFallbackPages.length > 0) {
        this.requestDetailPreviews(rasterFallbackPages, maxLongEdge);
      }
    },
    requestLayoutSvgPreview(
      layout: LayoutGrid,
      guides: GuideCoordinates | undefined,
    ) {
      if (!this.worker || !this.info) return;
      this.layoutPreviewRequestId += 1;
      this.disposeLayoutSvgPreview();
      this.layoutSvgPreviewStatus = "running";
      this.worker.postMessage({
        type: "request-layout-svg-preview",
        requestId: this.requestId,
        layoutPreviewRequestId: this.layoutPreviewRequestId,
        layout,
        guides,
        removeGuides: this.previewRemoveGuides,
        guideDetection: { ...this.previewGuideDetection },
      } satisfies PdfWorkerRequest);
    },
    renderRegion(
      pageNumber: number,
      options: PdfRegionRenderOptions,
    ): Promise<DesktopPdfRegion> {
      if (!this.worker || !this.info) return Promise.reject(new Error("请先打开 PDF。"));
      this.regionRequestId += 1;
      const regionRequestId = this.regionRequestId;
      const pending = pendingRegions.get(this) ?? new Map();
      pendingRegions.set(this, pending);
      const promise = new Promise<DesktopPdfRegion>((resolve, reject) => {
        pending.set(regionRequestId, { resolve, reject });
      });
      this.worker.postMessage({
        type: "render-region",
        requestId: this.requestId,
        regionRequestId,
        pageNumber,
        options: {
          ...options,
          removeGuides: this.previewRemoveGuides,
          guideDetection: { ...this.previewGuideDetection },
        },
      } satisfies PdfWorkerRequest);
      return promise;
    },
    cancelPreview() {
      if (!this.worker || this.previewStatus !== "running") return;
      this.worker.postMessage({
        type: "cancel-task",
        requestId: this.requestId,
        task: "preview",
      } satisfies PdfWorkerRequest);
    },
    exportVector(
      format: VectorExportFormat,
      layout: LayoutGrid,
      guides: GuideCoordinates | undefined,
      svgOverrides: Partial<SvgExportOptions> = {},
      pltOverrides: Partial<PltExportOptions> = {},
    ): Promise<DesktopVectorExport> {
      if (!this.worker || !this.info) return Promise.reject(new Error("请先打开 PDF。"));
      if (pendingExports.has(this)) return Promise.reject(new Error("已有矢量导出任务正在进行。"));
      this.exportStatus = "running";
      this.exportProgress = { completed: 0, total: this.info.pageCount };
      this.exportSummary = undefined;
      this.exportErrorMessage = "";
      const request: PdfWorkerRequest = {
        type: "export-vector",
        requestId: this.requestId,
        format,
        layout: JSON.parse(JSON.stringify(layout)) as LayoutGrid,
        guides: guides ? { ...guides } : undefined,
        svgOptions: { ...DEFAULT_SVG_EXPORT_OPTIONS, ...svgOverrides },
        pltOptions: { ...DEFAULT_PLT_EXPORT_OPTIONS, ...pltOverrides },
      };
      return new Promise<DesktopVectorExport>((resolve, reject) => {
        pendingExports.set(this, { resolve, reject });
        this.worker?.postMessage(request);
      });
    },
    exportSvg(
      layout: LayoutGrid,
      guides: GuideCoordinates | undefined,
      overrides: Partial<SvgExportOptions> = {},
    ): Promise<DesktopVectorExport> {
      return this.exportVector("svg", layout, guides, overrides);
    },
    detectGuides(options: GuideDetectionOptions): Promise<GuideDetectionResult> {
      if (!this.worker || !this.info) return Promise.reject(new Error("请先打开 PDF。"));
      if (pendingDetections.has(this)) return Promise.reject(new Error("红线检测已在进行中。"));
      this.detectionStatus = "running";
      this.detectionErrorMessage = "";
      this.detectionProgress = { completed: 0, total: this.info.pageCount };
      const request: PdfWorkerRequest = {
        type: "detect-guides",
        requestId: this.requestId,
        options: { ...options },
      };
      return new Promise<GuideDetectionResult>((resolve, reject) => {
        pendingDetections.set(this, { resolve, reject });
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
      pendingExports.get(this)?.reject(new Error("矢量导出已取消。"));
      pendingExports.delete(this);
      this.exportStatus = "idle";
      this.exportProgress = { completed: 0, total: 0 };
      this.exportSummary = undefined;
      this.exportErrorMessage = "";
    },
    dispose() {
      this.close();
      this.worker?.terminate();
      this.worker = undefined;
      pendingExports.delete(this);
      pendingDetections.delete(this);
      rejectPendingRegions(this, "局部放大已取消。");
      pendingRegions.delete(this);
    },
  },
});
