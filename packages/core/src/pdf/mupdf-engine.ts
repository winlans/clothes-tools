import {
  validateUniformPageSizes,
  type OpenDocumentResult,
  type PdfPageInfo,
  type PreviewImage,
  type PreviewOptions,
  type PdfRegionImage,
  type PdfRegionRenderOptions,
} from "./document";
import { Pdf2PltError } from "./errors";
import {
  buildGuideDetectionResult,
  detectPageGuideSamples,
  GUIDE_DIRECTIONS,
  removeRedGuidePixels,
  resolveGuideDetectionOptions,
  type GuideDetectionOptions,
  type GuideDetectionResult,
  type GuidePixelPage,
} from "../guides/detection";
import {
  applyGuideStitchingMode,
  runContentOverlapDpiFallback,
  runContentOverlapDpiFallbackAsync,
} from "../guides/content-overlap";

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

  const renderRegion = (
    pageNumber: number,
    options: PdfRegionRenderOptions,
  ): PdfRegionImage => {
    ensureOpen();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new Pdf2PltError(
        "invalid-page",
        `页码 ${pageNumber} 超出范围 1..${pageCount}。`,
      );
    }
    const values = [
      options.x,
      options.y,
      options.width,
      options.height,
      options.outputWidth,
      options.outputHeight,
    ];
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Pdf2PltError("invalid-region", "局部放大区域必须使用有限数值。");
    }
    if (
      options.width <= 0 ||
      options.height <= 0 ||
      options.outputWidth <= 0 ||
      options.outputHeight <= 0 ||
      options.outputWidth > 4096 ||
      options.outputHeight > 4096
    ) {
      throw new Pdf2PltError("invalid-region", "局部放大区域或输出尺寸无效。");
    }

    const outputWidth = Math.max(1, Math.round(options.outputWidth));
    const outputHeight = Math.max(1, Math.round(options.outputHeight));
    const page = document.loadPage(pageNumber - 1);
    try {
      const [pageX0, pageY0] = page.getBounds();
      const scaleX = outputWidth / options.width;
      const scaleY = outputHeight / options.height;
      const pixmap = new mupdf.Pixmap(
        mupdf.ColorSpace.DeviceRGB,
        [0, 0, outputWidth, outputHeight],
        false,
      );
      let device: InstanceType<MuPdfModule["DrawDevice"]> | undefined;
      try {
        pixmap.clear(255);
        device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
        page.run(device, [
          scaleX,
          0,
          0,
          scaleY,
          -(pageX0 + options.x) * scaleX,
          -(pageY0 + options.y) * scaleY,
        ]);
        device.close();
        if (options.removeGuides !== false) {
          removeRedGuidePixels(
            {
              pageNumber,
              width: outputWidth,
              height: outputHeight,
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
          width: outputWidth,
          height: outputHeight,
          mimeType: "image/png",
          bytes: png,
        };
      } finally {
        device?.destroy();
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
    stitchingMode: "auto" | "red-guides" | "content-overlap" = "auto",
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
    let redResult: GuideDetectionResult;
    if (stitchingMode === "content-overlap") {
      redResult = {
        lines: {},
        missing: [...GUIDE_DIRECTIONS],
        options,
      };
    } else {
      const samples = [];
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        samples.push(samplePage(pageIndex));
      }
      redResult = buildGuideDetectionResult(samples, pageSizePt, options);
    }
    if (
      stitchingMode === "red-guides" ||
      (stitchingMode === "auto" && Object.keys(redResult.lines).length > 0)
    ) return redResult;

    return runContentOverlapDpiFallback(options.dpi, (contentDpi) => {
      const contentScale = contentDpi / 72;
      const overlapPages: GuidePixelPage[] = [];
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const page = document.loadPage(pageIndex);
        try {
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(contentScale, contentScale),
            mupdf.ColorSpace.DeviceRGB,
            false,
            true,
          );
          try {
            const source = pixmap.getPixels();
            const pixels = new Uint8Array(source.byteLength);
            pixels.set(source);
            overlapPages.push({
              pageNumber: pageIndex + 1,
              width: pixmap.getWidth(),
              height: pixmap.getHeight(),
              stride: pixmap.getStride(),
              components: pixmap.getNumberOfComponents(),
              pixels,
            });
          } finally {
            pixmap.destroy();
          }
        } finally {
          page.destroy();
        }
      }
      return applyGuideStitchingMode(stitchingMode, redResult, overlapPages, pageSizePt);
    });
  };

  const detectGuidesAsync: OpenDocumentResult["detectGuidesAsync"] = async (
    overrides = {},
    hooks = {},
    stitchingMode = "auto",
  ) => {
    ensureOpen();
    const options = resolveGuideDetectionOptions(overrides);
    const scale = options.dpi / 72;
    let redResult: GuideDetectionResult;
    if (stitchingMode === "content-overlap") {
      redResult = {
        lines: {},
        missing: [...GUIDE_DIRECTIONS],
        options,
      };
    } else {
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
        hooks.onProgress?.(pageIndex + 1, pageCount, "red-guides");
        await (hooks.yieldControl?.() ?? Promise.resolve());
      }
      redResult = buildGuideDetectionResult(samples, pageSizePt, options);
    }
    if (
      stitchingMode === "red-guides" ||
      (stitchingMode === "auto" && Object.keys(redResult.lines).length > 0)
    ) return redResult;

    const redPhaseCount = stitchingMode === "content-overlap" ? 0 : 1;
    return runContentOverlapDpiFallbackAsync(
      options.dpi,
      async (contentDpi, attemptIndex, attemptCount) => {
        const contentScale = contentDpi / 72;
        const overlapPages: GuidePixelPage[] = [];
        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
          if (hooks.isCancelled?.()) {
            throw new Pdf2PltError("task-cancelled", "内容匹配已取消。");
          }
          const page = document.loadPage(pageIndex);
          try {
            const pixmap = page.toPixmap(
              mupdf.Matrix.scale(contentScale, contentScale),
              mupdf.ColorSpace.DeviceRGB,
              false,
              true,
            );
            try {
              const source = pixmap.getPixels();
              const pixels = new Uint8Array(source.byteLength);
              pixels.set(source);
              overlapPages.push({
                pageNumber: pageIndex + 1,
                width: pixmap.getWidth(),
                height: pixmap.getHeight(),
                stride: pixmap.getStride(),
                components: pixmap.getNumberOfComponents(),
                pixels,
              });
            } finally {
              pixmap.destroy();
            }
          } finally {
            page.destroy();
          }
          const completedPhases = redPhaseCount + attemptIndex;
          hooks.onProgress?.(
            completedPhases * pageCount + pageIndex + 1,
            (redPhaseCount + attemptCount) * pageCount,
            "content-overlap",
          );
          await (hooks.yieldControl?.() ?? Promise.resolve());
        }
        return applyGuideStitchingMode(stitchingMode, redResult, overlapPages, pageSizePt);
      },
    );
  };

  return {
    info: {
      documentId,
      pageCount,
      pageSizePt,
      pages,
    },
    renderPreview,
    renderRegion,
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
