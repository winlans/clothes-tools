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
  removeRedGuidePixels,
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
        if (options.removeGuides !== false) {
          removeRedGuidePixels(
            {
              pageNumber,
              width: pixmap.getWidth(),
              height: pixmap.getHeight(),
              stride: pixmap.getStride(),
              components: pixmap.getNumberOfComponents(),
              pixels: pixmap.getPixels(),
            },
            resolveGuideDetectionOptions(options.guideDetection),
          );
        }
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

  const renderSvgPage = (pageNumber: number): string => {
    ensureOpen();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new Pdf2PltError("invalid-page", `页码 ${pageNumber} 超出范围 1..${pageCount}。`);
    }
    const page = document.loadPage(pageNumber - 1);
    const buffer = new mupdf.Buffer();
    const writer = new mupdf.DocumentWriter(buffer, "svg", "text=path");
    let device: InstanceType<MuPdfModule["Device"]> | undefined;
    let closed = false;
    try {
      device = writer.beginPage(page.getBounds());
      page.run(device, mupdf.Matrix.identity);
      writer.endPage();
      writer.close();
      closed = true;
      return new TextDecoder().decode(buffer.asUint8Array());
    } finally {
      if (!closed) {
        try {
          writer.close();
        } catch {
          // Preserve the original MuPDF error.
        }
      }
      device?.destroy();
      writer.destroy();
      buffer.destroy();
      page.destroy();
    }
  };

  const detectGuides = (
    overrides: Partial<GuideDetectionOptions> = {},
  ) => {
    ensureOpen();
    const options = resolveGuideDetectionOptions(overrides);
    const scale = options.dpi / 72;
    const samplePage = (pageIndex: number) => {
      const page = document.loadPage(pageIndex);
      try {
        const pixmap = page.toPixmap(
          mupdf.Matrix.scale(scale, scale),
          mupdf.ColorSpace.DeviceRGB,
          false,
          true,
        );
        try {
          return detectPageGuideSamples(
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
          );
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    };
    const samples = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      samples.push(samplePage(pageIndex));
    }
    return buildGuideDetectionResult(samples, pageSizePt, options);
  };

  const detectGuidesAsync: OpenDocumentResult["detectGuidesAsync"] = async (
    overrides = {},
    hooks = {},
  ) => {
    ensureOpen();
    const options = resolveGuideDetectionOptions(overrides);
    const scale = options.dpi / 72;
    const samples = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      if (hooks.isCancelled?.()) {
        throw new Pdf2PltError("task-cancelled", "红线检测已取消。");
      }
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
      hooks.onProgress?.(pageIndex + 1, pageCount);
      await (hooks.yieldControl?.() ?? Promise.resolve());
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
    renderSvgPage,
    detectGuides,
    detectGuidesAsync,
    close() {
      if (!closed) {
        closed = true;
        document.destroy();
      }
    },
  };
}
