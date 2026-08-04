import type { GuideDetectionResult, PdfDocumentInfo } from "@pdf2plt/core";

export type PdfWorkerRequest =
  | {
      type: "open";
      requestId: number;
      bytes: Uint8Array<ArrayBuffer>;
      previewLongEdge: number;
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
      type: "complete";
      requestId: number;
    }
  | {
      type: "error";
      requestId: number;
      code: string;
      message: string;
    };
