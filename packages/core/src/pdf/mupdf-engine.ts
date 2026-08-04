import {
  validateUniformPageSizes,
  type OpenDocumentResult,
  type PdfPageInfo,
  type PreviewImage,
  type PreviewOptions,
} from "./document";
import { Pdf2PltError } from "./errors";
import {
  buildGuideDetectionResult,
  detectPageGuideSamples,
  resolveGuideDetectionOptions,
  type GuideDetectionOptions,
} from "../guides/detection";

export type MuPdfModule = (typeof import("mupdf"))["default"];

let nextDocumentId = 1;

export async function openMuPdfDocument(
  mupdf: MuPdfModule,
  bytes: Uint8Array,
): Promise<OpenDocumentResult> {
  let document: InstanceType<MuPdfModule["Document"]>;
  try {
    document = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch (error) {
    throw new Pdf2PltError("invalid-pdf", "无法解析 PDF 文件。", {
      cause: error,
    });
  }

  if (document.needsPassword()) {
    document.destroy();
    throw new Pdf2PltError(
      "password-required",
      "该 PDF 需要密码，当前版本暂不支持加密 PDF。",
    );
  }

  const pageCount = document.countPages();
  const pages: PdfPageInfo[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.loadPage(index);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      pages.push({
        pageNumber: index + 1,
        width: x1 - x0,
        height: y1 - y0,
      });
    } finally {
      page.destroy();
    }
  }

  let pageSizePt;
  try {
    pageSizePt = validateUniformPageSizes(pages);
  } catch (error) {
    document.destroy();
    throw error;
  }

  let closed = false;
  const ensureOpen = () => {
    if (closed) {
      throw new Pdf2PltError("document-closed", "PDF 文档已经关闭。");
    }
  };

  const renderPreview = (
    pageNumber: number,
    options: PreviewOptions,
  ): PreviewImage => {
    ensureOpen();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new Pdf2PltError(
        "invalid-page",
        `页码 ${pageNumber} 超出范围 1..${pageCount}。`,
      );
    }
    if (!Number.isFinite(options.maxLongEdge) || options.maxLongEdge <= 0) {
      throw new Pdf2PltError("invalid-preview-size", "预览尺寸必须大于 0。");
    }

    const pageInfo = pages[pageNumber - 1];
    if (!pageInfo) {
      throw new Pdf2PltError("invalid-page", `找不到第 ${pageNumber} 页。`);
    }
    const scale = options.maxLongEdge / Math.max(pageInfo.width, pageInfo.height);
    const page = document.loadPage(pageNumber - 1);
    try {
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      );
      try {
        const source = pixmap.asPNG();
        const png = new Uint8Array(source.byteLength);
        png.set(source);
        return {
          pageNumber,
          width: pixmap.getWidth(),
          height: pixmap.getHeight(),
          mimeType: "image/png",
          bytes: png,
        };
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  };

  const documentId = `pdf-${nextDocumentId}`;
  nextDocumentId += 1;

  const detectGuides = (
    overrides: Partial<GuideDetectionOptions> = {},
  ) => {
    ensureOpen();
    const options = resolveGuideDetectionOptions(overrides);
    const scale = options.dpi / 72;
    const samples = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const page = document.loadPage(pageIndex);
      try {
        const pixmap = page.toPixmap(
          mupdf.Matrix.scale(scale, scale),
          mupdf.ColorSpace.DeviceRGB,
          false,
          true,
        );
        try {
          samples.push(
            detectPageGuideSamples(
              {
                pageNumber: pageIndex + 1,
                width: pixmap.getWidth(),
                height: pixmap.getHeight(),
                stride: pixmap.getStride(),
                components: pixmap.getNumberOfComponents(),
                pixels: pixmap.getPixels(),
              },
              pageSizePt,
              options,
            ),
          );
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    }
    return buildGuideDetectionResult(samples, pageSizePt, options);
  };

  return {
    info: {
      documentId,
      pageCount,
      pageSizePt,
      pages,
    },
    renderPreview,
    detectGuides,
    close() {
      if (!closed) {
        closed = true;
        document.destroy();
      }
    },
  };
}
