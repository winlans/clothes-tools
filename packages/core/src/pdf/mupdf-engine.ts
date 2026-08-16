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
  detectPatternGuides,
  detectPageGuideSamples,
  GUIDE_DIRECTIONS,
  removeGuidePixelsAtCoordinates,
  removeRedGuidePixels,
  resolveGuideDetectionOptions,
  type GuideDetectionOptions,
  type GuideDetectionResult,
  type GuidePixelPage,
} from "../guides/detection";
import {
  applyGuideStitchingMode,
  contentOverlapDpiCandidates,
  runContentOverlapDpiFallback,
  runContentOverlapDpiFallbackAsync,
} from "../guides/content-overlap";
import {
  createVectorExclusionDevice,
  type VectorDeviceMode,
  type VectorObjectExclusionRule,
} from "./vector-exclusion";

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
      const matrix = mupdf.Matrix.scale(scale, scale);
      const exclusions = options.objectExclusions ?? [];
      const pixmap = exclusions.length === 0
        ? page.toPixmap(
            matrix,
            mupdf.ColorSpace.DeviceRGB,
            false,
            true,
          )
        : new mupdf.Pixmap(
            mupdf.ColorSpace.DeviceRGB,
            [0, 0, Math.max(1, Math.ceil(pageInfo.width * scale)), Math.max(1, Math.ceil(pageInfo.height * scale))],
            false,
          );
      let drawDevice: InstanceType<MuPdfModule["DrawDevice"]> | undefined;
      let exclusionDevice: ReturnType<typeof createVectorExclusionDevice> | undefined;
      try {
        if (exclusions.length > 0) {
          pixmap.clear(255);
          drawDevice = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
          exclusionDevice = createVectorExclusionDevice(
            mupdf,
            drawDevice,
            pageNumber,
            pageInfo,
            exclusions,
            "exclude",
            matrix,
          );
          page.run(exclusionDevice.device, matrix);
          exclusionDevice.destroy();
          exclusionDevice = undefined;
          drawDevice.close();
        }
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
          if (options.guides) {
            removeGuidePixelsAtCoordinates(
              {
                pageNumber,
                width: pixmap.getWidth(),
                height: pixmap.getHeight(),
                stride: pixmap.getStride(),
                components: pixmap.getNumberOfComponents(),
                pixels: pixmap.getPixels(),
              },
              pageInfo,
              options.guides,
            );
          }
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
        exclusionDevice?.destroy();
        drawDevice?.destroy();
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

    const pageInfo = pages[pageNumber - 1];
    if (!pageInfo) {
      throw new Pdf2PltError("invalid-page", `找不到第 ${pageNumber} 页。`);
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
        const matrix: [number, number, number, number, number, number] = [
          scaleX,
          0,
          0,
          scaleY,
          -(pageX0 + options.x) * scaleX,
          -(pageY0 + options.y) * scaleY,
        ];
        const exclusions = options.objectExclusions ?? [];
        if (exclusions.length > 0) {
          const exclusionDevice = createVectorExclusionDevice(
            mupdf,
            device,
            pageNumber,
            pageInfo,
            exclusions,
            "exclude",
            matrix,
          );
          try {
            page.run(exclusionDevice.device, matrix);
          } finally {
            exclusionDevice.destroy();
          }
        } else {
          page.run(device, matrix);
        }
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
          if (options.guides) {
            removeGuidePixelsAtCoordinates(
              {
                pageNumber,
                width: outputWidth,
                height: outputHeight,
                stride: pixmap.getStride(),
                components: pixmap.getNumberOfComponents(),
                pixels: pixmap.getPixels(),
              },
              pageInfo,
              options.guides,
              {
                x: options.x,
                y: options.y,
                width: options.width,
                height: options.height,
              },
            );
          }
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

  const writeSvgPage = (
    pageNumber: number,
    rules: readonly VectorObjectExclusionRule[],
    mode: VectorDeviceMode,
  ) => {
    ensureOpen();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new Pdf2PltError("invalid-page", `页码 ${pageNumber} 超出范围 1..${pageCount}。`);
    }
    const page = document.loadPage(pageNumber - 1);
    const buffer = new mupdf.Buffer();
    const writer = new mupdf.DocumentWriter(buffer, "svg", "text=path");
    let device: InstanceType<MuPdfModule["Device"]> | undefined;
    let exclusionDevice: ReturnType<typeof createVectorExclusionDevice> | undefined;
    let closed = false;
    try {
      device = writer.beginPage(page.getBounds());
      exclusionDevice = rules.length > 0
        ? createVectorExclusionDevice(
            mupdf,
            device,
            pageNumber,
            pages[pageNumber - 1] ?? pageSizePt,
            rules,
            mode,
          )
        : undefined;
      page.run(exclusionDevice?.device ?? device, mupdf.Matrix.identity);
      const selectedObjects = exclusionDevice?.selectedObjects ?? [];
      exclusionDevice?.destroy();
      exclusionDevice = undefined;
      writer.endPage();
      writer.close();
      closed = true;
      return {
        svg: new TextDecoder().decode(buffer.asUint8Array()),
        selectedObjects,
      };
    } finally {
      if (!closed) {
        try {
          writer.close();
        } catch {
          // Preserve the original MuPDF error.
        }
      }
      exclusionDevice?.destroy();
      device?.destroy();
      writer.destroy();
      buffer.destroy();
      page.destroy();
    }
  };

  const renderSvgPage: OpenDocumentResult["renderSvgPage"] = (pageNumber, options = {}) =>
    writeSvgPage(pageNumber, options.objectExclusions ?? [], "exclude").svg;

  const renderVectorSelection: OpenDocumentResult["renderVectorSelection"] = (
    pageNumber,
    rules,
  ) => {
    const result = writeSvgPage(pageNumber, rules, "overlay");
    return {
      pageNumber,
      selectedObjects: result.selectedObjects,
      overlaySvg: result.svg,
    };
  };

  const renderGuidePixelPage = (pageIndex: number, dpi: number): GuidePixelPage => {
    const scale = dpi / 72;
    const page = document.loadPage(pageIndex);
    try {
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      );
      try {
        const source = pixmap.getPixels();
        const pixels = new Uint8Array(source.byteLength);
        pixels.set(source);
        return {
          pageNumber: pageIndex + 1,
          width: pixmap.getWidth(),
          height: pixmap.getHeight(),
          stride: pixmap.getStride(),
          components: pixmap.getNumberOfComponents(),
          pixels,
        };
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  };

  const renderGuidePixelPages = (dpi: number): GuidePixelPage[] =>
    Array.from({ length: pageCount }, (_, pageIndex) =>
      renderGuidePixelPage(pageIndex, dpi)
    );

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
    if (stitchingMode !== "content-overlap" && Object.keys(redResult.lines).length > 0) {
      return redResult;
    }

    let patternPages: GuidePixelPage[] | undefined;
    if (stitchingMode !== "content-overlap") {
      patternPages = renderGuidePixelPages(options.dpi);
      const patternResult = detectPatternGuides(patternPages, pageSizePt, options);
      if (patternResult.inferredLayout) return patternResult;
      if (stitchingMode === "red-guides") {
        return Object.keys(patternResult.lines).length > 0 ? patternResult : redResult;
      }
    }

    return runContentOverlapDpiFallback(options.dpi, (contentDpi) => {
      const overlapPages = contentDpi === options.dpi && patternPages
        ? patternPages
        : renderGuidePixelPages(contentDpi);
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
          throw new Pdf2PltError("task-cancelled", "颜色辅助线识别已取消。");
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
    if (stitchingMode !== "content-overlap" && Object.keys(redResult.lines).length > 0) {
      return redResult;
    }

    const redPhaseCount = stitchingMode === "content-overlap" ? 0 : 1;
    let patternPages: GuidePixelPage[] | undefined;
    if (stitchingMode !== "content-overlap") {
      patternPages = [];
      const contentAttemptCount = contentOverlapDpiCandidates(options.dpi).length;
      const totalPhases = stitchingMode === "red-guides"
        ? redPhaseCount + 1
        : redPhaseCount + contentAttemptCount;
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        if (hooks.isCancelled?.()) {
          throw new Pdf2PltError("task-cancelled", "辅助线模式识别已取消。");
        }
        patternPages.push(renderGuidePixelPage(pageIndex, options.dpi));
        hooks.onProgress?.(
          redPhaseCount * pageCount + pageIndex + 1,
          totalPhases * pageCount,
          "guide-pattern",
        );
        await (hooks.yieldControl?.() ?? Promise.resolve());
      }
      const patternResult = detectPatternGuides(patternPages, pageSizePt, options);
      if (patternResult.inferredLayout) return patternResult;
      if (stitchingMode === "red-guides") {
        return Object.keys(patternResult.lines).length > 0 ? patternResult : redResult;
      }
    }

    return runContentOverlapDpiFallbackAsync(
      options.dpi,
      async (contentDpi, attemptIndex, attemptCount) => {
        if (contentDpi === options.dpi && patternPages) {
          const result = applyGuideStitchingMode(
            stitchingMode,
            redResult,
            patternPages,
            pageSizePt,
          );
          hooks.onProgress?.(
            (redPhaseCount + 1) * pageCount,
            (redPhaseCount + attemptCount) * pageCount,
            "content-overlap",
          );
          await (hooks.yieldControl?.() ?? Promise.resolve());
          return result;
        }
        const overlapPages: GuidePixelPage[] = [];
        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
          if (hooks.isCancelled?.()) {
            throw new Pdf2PltError("task-cancelled", "内容匹配已取消。");
          }
          overlapPages.push(renderGuidePixelPage(pageIndex, contentDpi));
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
    renderVectorSelection,
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
