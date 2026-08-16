import { Pdf2PltError } from "./errors";
import type {
  GuideDetectionOptions,
  GuideDetectionPhase,
  GuideDetectionResult,
  GuideStitchingMode,
} from "../guides/detection";
import type { GuideCoordinates } from "../guides/crop";

export interface PageSizePt {
  width: number;
  height: number;
}

export interface PdfPageInfo extends PageSizePt {
  pageNumber: number;
}

export interface PdfDocumentInfo {
  documentId: string;
  pageCount: number;
  pageSizePt: PageSizePt;
  pages: PdfPageInfo[];
}

export interface PreviewOptions {
  maxLongEdge: number;
  removeGuides?: boolean;
  guideDetection?: Partial<GuideDetectionOptions>;
  guides?: GuideCoordinates;
}

export interface PreviewImage {
  pageNumber: number;
  width: number;
  height: number;
  mimeType: "image/png";
  bytes: Uint8Array<ArrayBuffer>;
}

export interface PdfRegionRenderOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  removeGuides?: boolean;
  guideDetection?: Partial<GuideDetectionOptions>;
  guides?: GuideCoordinates;
}

export interface PdfRegionImage {
  pageNumber: number;
  width: number;
  height: number;
  mimeType: "image/png";
  bytes: Uint8Array<ArrayBuffer>;
}

export interface OpenDocumentResult {
  info: PdfDocumentInfo;
  renderPreview(pageNumber: number, options: PreviewOptions): PreviewImage;
  renderRegion(pageNumber: number, options: PdfRegionRenderOptions): PdfRegionImage;
  renderSvgPage(pageNumber: number): string;
  detectGuides(
    options?: Partial<GuideDetectionOptions>,
    stitchingMode?: GuideStitchingMode,
  ): GuideDetectionResult;
  detectGuidesAsync(
    options?: Partial<GuideDetectionOptions>,
    hooks?: {
      isCancelled?(): boolean;
      onProgress?(
        completed: number,
        total: number,
        phase?: GuideDetectionPhase,
      ): void;
      yieldControl?(): Promise<void>;
    },
    stitchingMode?: GuideStitchingMode,
  ): Promise<GuideDetectionResult>;
  close(): void;
}

export function validateUniformPageSizes(
  pages: readonly PdfPageInfo[],
  tolerancePt = 0.02,
): PageSizePt {
  const first = pages[0];
  if (!first) {
    throw new Pdf2PltError("empty-document", "PDF 没有可用页面。");
  }

  for (const page of pages.slice(1)) {
    const widthDifference = Math.abs(page.width - first.width);
    const heightDifference = Math.abs(page.height - first.height);
    if (widthDifference > tolerancePt || heightDifference > tolerancePt) {
      throw new Pdf2PltError(
        "page-size-mismatch",
        `第 ${page.pageNumber} 页尺寸 ${page.width.toFixed(3)} × ${page.height.toFixed(3)} pt ` +
          `与第 1 页 ${first.width.toFixed(3)} × ${first.height.toFixed(3)} pt 不一致。`,
      );
    }
  }

  return { width: first.width, height: first.height };
}
