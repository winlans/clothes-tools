import type {
  GuideCoordinates,
  GuideDetectionOptions,
  GuideDetectionResult,
  GuideStitchingMode,
  LayoutGrid,
  PdfDocumentInfo,
  PdfRegionRenderOptions,
  PltExportOptions,
  SvgExportOptions,
} from "@pdf2plt/core";

export type VectorExportFormat = "svg" | "plt";

export type PdfWorkerRequest =
  | {
      type: "open";
      requestId: number;
      bytes: Uint8Array<ArrayBuffer>;
      previewLongEdge: number;
      previewPriority: number[];
      removePreviewGuides: boolean;
      previewGuideDetection: GuideDetectionOptions;
    }
  | { type: "request-previews"; requestId: number; pageNumbers: number[] }
  | { type: "request-vector-previews"; requestId: number; pageNumbers: number[] }
  | {
      type: "request-detail-previews";
      requestId: number;
      pageNumbers: number[];
      maxLongEdge: number;
    }
  | {
      type: "render-region";
      requestId: number;
      regionRequestId: number;
      pageNumber: number;
      options: PdfRegionRenderOptions;
    }
  | {
      type: "configure-preview-guides";
      requestId: number;
      removeGuides: boolean;
      options: GuideDetectionOptions;
      pageNumbers: number[];
    }
  | {
      type: "cancel-task";
      requestId: number;
      task: "preview" | "detection" | "export";
    }
  | {
      type: "detect-guides";
      requestId: number;
      options: GuideDetectionOptions;
      stitchingMode: GuideStitchingMode;
    }
  | {
      type: "export-vector";
      requestId: number;
      format: VectorExportFormat;
      layout: LayoutGrid;
      guides: GuideCoordinates | undefined;
      svgOptions: SvgExportOptions;
      pltOptions: PltExportOptions;
    }
  | { type: "close"; requestId: number };

export type PdfWorkerResponse =
  | {
      type: "document";
      requestId: number;
      info: PdfDocumentInfo;
    }
  | {
      type: "preview";
      requestId: number;
      pageNumber: number;
      width: number;
      height: number;
      bytes: Uint8Array<ArrayBuffer>;
    }
  | {
      type: "vector-preview";
      requestId: number;
      pageNumber: number;
      width: number;
      height: number;
      svg: string;
    }
  | {
      type: "vector-preview-error";
      requestId: number;
      pageNumber: number;
      code: string;
      message: string;
    }
  | {
      type: "detail-preview";
      requestId: number;
      pageNumber: number;
      maxLongEdge: number;
      width: number;
      height: number;
      bytes: Uint8Array<ArrayBuffer>;
    }
  | {
      type: "detail-preview-error";
      requestId: number;
      pageNumber: number;
      maxLongEdge: number;
      code: string;
      message: string;
    }
  | {
      type: "region";
      requestId: number;
      regionRequestId: number;
      pageNumber: number;
      width: number;
      height: number;
      bytes: Uint8Array<ArrayBuffer>;
    }
  | {
      type: "region-error";
      requestId: number;
      regionRequestId: number;
      code: string;
      message: string;
    }
  | {
      type: "guides";
      requestId: number;
      result: GuideDetectionResult;
    }
  | {
      type: "progress";
      requestId: number;
      completed: number;
      total: number;
    }
  | {
      type: "detection-progress";
      requestId: number;
      completed: number;
      total: number;
      phase?: "red-guides" | "content-overlap";
    }
  | {
      type: "complete";
      requestId: number;
    }
  | {
      type: "export-progress";
      requestId: number;
      completed: number;
      total: number;
    }
  | {
      type: "vector-export";
      requestId: number;
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
  | {
      type: "export-error";
      requestId: number;
      code: string;
      message: string;
    }
  | {
      type: "guides-error";
      requestId: number;
      code: string;
      message: string;
    }
  | {
      type: "task-cancelled";
      requestId: number;
      task: "preview" | "detection" | "export";
    }
  | {
      type: "error";
      requestId: number;
      code: string;
      message: string;
    };
