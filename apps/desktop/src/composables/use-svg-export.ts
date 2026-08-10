import { getUnusedLayoutPages, resolveGuideGeometry } from "@pdf2plt/core";
import { isTauri } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { exists, writeFile } from "@tauri-apps/plugin-fs";
import { toValue, type MaybeRefOrGetter } from "vue";

import { useResolvedSettings } from "./use-resolved-settings";
import { detectedGuideCoordinates, guideSettingsFromLines } from "../project/guide-settings";
import type { DocumentSession } from "../stores/document-session";
import { useLayoutStore } from "../stores/layout";
import { usePdfDocumentStore } from "../stores/pdf-document";
import { useProjectStore } from "../stores/project";
import type { VectorExportFormat } from "../workers/protocol";

export type { VectorExportFormat } from "../workers/protocol";

export interface VectorBatchEntry {
  session: DocumentSession;
  fileName: string;
}

export interface VectorBatchExportResult {
  cancelled: boolean;
  exported: string[];
  errors: string[];
  warnings: string[];
}

const FORMAT_DETAILS: Record<VectorExportFormat, {
  extension: string;
  label: string;
  mimeType: string;
}> = {
  svg: { extension: "svg", label: "SVG", mimeType: "image/svg+xml" },
  plt: { extension: "plt", label: "PLT", mimeType: "application/vnd.hp-hpgl" },
};

export function exportFormatLabel(format: VectorExportFormat): string {
  return FORMAT_DETAILS[format].label;
}

export function defaultExportName(fileName: string, format: VectorExportFormat): string {
  return fileName.replace(/\.pdf$/i, "") + `.${FORMAT_DETAILS[format].extension}`;
}

export function normalizeExportName(
  value: string,
  fallback: string,
  format: VectorExportFormat,
): string {
  const sanitized = value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "");
  const name = sanitized || defaultExportName(fallback, format);
  const extension = FORMAT_DETAILS[format].extension;
  const otherExtension = format === "svg" ? /\.plt$/i : /\.svg$/i;
  const formatName = name.replace(otherExtension, `.${extension}`);
  return new RegExp(`\\.${extension}$`, "i").test(formatName)
    ? formatName
    : `${formatName}.${extension}`;
}

export const defaultSvgName = (fileName: string) => defaultExportName(fileName, "svg");
export const normalizeSvgName = (value: string, fallback: string) =>
  normalizeExportName(value, fallback, "svg");

export function validateSessionExport(session: DocumentSession): string {
  const { documentStore, layoutStore, guideStore, projectStore } = session;
  if (documentStore.exportStatus === "running") return "该标签正在导出。";
  const pageSize = documentStore.info?.pageSizePt;
  const layout = layoutStore.layout;
  if (!pageSize || !layout) return "PDF 尚未解析完成。";
  const unusedPages = getUnusedLayoutPages(layout, documentStore.info?.pageCount ?? 0);
  if (unusedPages.length > 0 && !projectStore.outputSettings.allowUnusedPages) {
    return `布局仍有未使用页：${unusedPages.join("、")}。`;
  }
  try {
    resolveGuideGeometry(
      guideSettingsFromLines(projectStore.guideSettings, guideStore.lines),
      detectedGuideCoordinates(documentStore.guideDetection),
      pageSize,
      layout,
    );
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "当前设置无法导出。";
  }
}

function downloadBytes(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string,
  format: VectorExportFormat,
) {
  const url = URL.createObjectURL(new Blob([bytes], { type: FORMAT_DETAILS[format].mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function generateSessionVector(session: DocumentSession, format: VectorExportFormat) {
  const { documentStore, layoutStore, guideStore, projectStore } = session;
  const layout = layoutStore.layout;
  const pageSize = documentStore.info?.pageSizePt;
  if (!layout || !pageSize) throw new Error("PDF 尚未解析完成。");
  const validationError = validateSessionExport(session);
  if (validationError) throw new Error(validationError);
  const resolved = resolveGuideGeometry(
    guideSettingsFromLines(projectStore.guideSettings, guideStore.lines),
    detectedGuideCoordinates(documentStore.guideDetection),
    pageSize,
    layout,
  );
  return documentStore.exportVector(format, layout, resolved.coordinates, {
    removeGuides: !projectStore.outputSettings.keepGuides,
    removeBackground: !projectStore.outputSettings.keepBackground,
  });
}

export function useVectorExport(sessionSource?: MaybeRefOrGetter<DocumentSession | undefined>) {
  const fallback = sessionSource
    ? undefined
    : {
        documentStore: usePdfDocumentStore(),
        layoutStore: useLayoutStore(),
        projectStore: useProjectStore(),
      };
  const session = () => toValue(sessionSource);
  const settings = useResolvedSettings(
    () => session()?.documentStore.info?.pageSizePt ?? fallback?.documentStore.info?.pageSizePt,
    sessionSource,
  );

  async function exportCurrent(format: VectorExportFormat) {
    const details = FORMAT_DETAILS[format];
    const current = session();
    if (current) {
      const validationError = validateSessionExport(current);
      if (validationError) {
        current.documentStore.exportStatus = "error";
        current.documentStore.exportErrorMessage = validationError;
        return;
      }
      const fileName = defaultExportName(current.documentStore.fileName, format);
      let selectedPath: string | undefined;
      if (isTauri()) {
        const selected = await save({
          defaultPath: fileName,
          filters: [{ name: details.label, extensions: [details.extension] }],
        });
        if (!selected) return;
        selectedPath = selected;
      }
      try {
        const result = await generateSessionVector(current, format);
        if (selectedPath) await writeFile(selectedPath, result.bytes);
        else downloadBytes(result.bytes, fileName, format);
      } catch (error) {
        if (current.documentStore.exportStatus === "cancelled") return;
        current.documentStore.exportStatus = "error";
        current.documentStore.exportErrorMessage =
          error instanceof Error ? error.message : `${details.label} 导出失败。`;
      }
      return;
    }

    const documentStore = fallback?.documentStore;
    const layoutStore = fallback?.layoutStore;
    const projectStore = fallback?.projectStore;
    const layout = layoutStore?.layout;
    if (!documentStore || !layout || !projectStore) return;
    const resolved = settings.resolved.value.value;
    if (!resolved || !settings.canExport.value) {
      documentStore.exportStatus = "error";
      documentStore.exportErrorMessage = settings.validationError.value || "当前设置无法导出。";
      return;
    }
    const fileName = defaultExportName(documentStore.fileName, format);
    const selectedPath = isTauri()
      ? await save({
          defaultPath: fileName,
          filters: [{ name: details.label, extensions: [details.extension] }],
        })
      : undefined;
    if (isTauri() && !selectedPath) return;
    try {
      const result = await documentStore.exportVector(format, layout, resolved.coordinates, {
        removeGuides: !projectStore.outputSettings.keepGuides,
        removeBackground: !projectStore.outputSettings.keepBackground,
      });
      if (selectedPath) await writeFile(selectedPath, result.bytes);
      else downloadBytes(result.bytes, fileName, format);
    } catch (error) {
      if (documentStore.exportStatus === "cancelled") return;
      documentStore.exportStatus = "error";
      documentStore.exportErrorMessage =
        error instanceof Error ? error.message : `${details.label} 导出失败。`;
    }
  }

  async function exportSelected(
    format: VectorExportFormat,
    entries: VectorBatchEntry[],
  ): Promise<VectorBatchExportResult> {
    const details = FORMAT_DETAILS[format];
    const result: VectorBatchExportResult = {
      cancelled: false,
      exported: [],
      errors: [],
      warnings: [],
    };
    const normalized = entries.map((entry) => ({
      ...entry,
      fileName: normalizeExportName(entry.fileName, entry.session.source.fileName, format),
    }));
    let directory: string | undefined;
    if (isTauri()) {
      const selected = await open({
        directory: true,
        multiple: false,
        title: `选择 ${details.label} 输出目录`,
      });
      if (!selected || Array.isArray(selected)) return { ...result, cancelled: true };
      directory = selected;
      for (const entry of normalized) {
        const destination = await join(directory, entry.fileName);
        if (await exists(destination)) {
          result.errors.push(`${entry.fileName} 已存在，请重命名后重试。`);
        }
      }
      if (result.errors.length > 0) return result;
    }

    for (const entry of normalized) {
      try {
        const generated = await generateSessionVector(entry.session, format);
        if (directory) {
          await writeFile(await join(directory, entry.fileName), generated.bytes);
        } else {
          downloadBytes(generated.bytes, entry.fileName, format);
        }
        result.exported.push(entry.fileName);
        result.warnings.push(
          ...generated.warnings.map((warning) => `${entry.fileName}：${warning}`),
        );
      } catch (error) {
        if (entry.session.documentStore.exportStatus === "cancelled") {
          result.errors.push(`${entry.fileName}：导出已取消。`);
        } else {
          const message = error instanceof Error ? error.message : "导出失败。";
          entry.session.documentStore.exportStatus = "error";
          entry.session.documentStore.exportErrorMessage = message;
          result.errors.push(`${entry.fileName}：${message}`);
        }
      }
    }
    return result;
  }

  return { exportCurrent, exportSelected };
}

export function useSvgExport(sessionSource?: MaybeRefOrGetter<DocumentSession | undefined>) {
  const vectorExport = useVectorExport(sessionSource);
  return {
    exportCurrentSvg: () => vectorExport.exportCurrent("svg"),
    exportSelectedSvgs: (entries: VectorBatchEntry[]) => vectorExport.exportSelected("svg", entries),
  };
}
