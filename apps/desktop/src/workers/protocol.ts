import type {
  GuideCoordinates,
  GuideDetectionOptions,
  GuideDetectionResult,
  LayoutGrid,
  PdfDocumentInfo,
  SvgExportOptions,
} from "@pdf2plt/core";

export type PdfWorkerRequest =
  | {
      type: "open";
      requestId: number;
      bytes: Uint8Array<ArrayBuffer>;
      previewLongEdge: number;
      previewPriority: number[];
    }
  | { type: "request-previews"; requestId: number; pageNumbers: number[] }
  | {
      type: "cancel-task";
      requestId: number;
      task: "preview" | "detection" | "export";
    }
  | {
      type: "detect-guides";
      requestId: number;
      options: GuideDetectionOptions;
    }
  | {
      type: "export-svg";
      requestId: number;
      layout: LayoutGrid;
      guides: GuideCoordinates | undefined;
      options: SvgExportOptions;
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
      type: "svg-export";
      requestId: number;
      bytes: Uint8Array<ArrayBuffer>;
      widthPt: number;
      heightPt: number;
      pageInstances: number;
      visibleObjects: number;
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
