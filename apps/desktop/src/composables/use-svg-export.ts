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

export interface SvgBatchEntry {
  session: DocumentSession;
  fileName: string;
}

export interface SvgBatchExportResult {
  cancelled: boolean;
  exported: string[];
  errors: string[];
}

export function defaultSvgName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "") + ".svg";
}

export function normalizeSvgName(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "");
  const name = sanitized || defaultSvgName(fallback);
  return /\.svg$/i.test(name) ? name : `${name}.svg`;
}

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

function downloadBytes(bytes: Uint8Array<ArrayBuffer>, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function generateSessionSvg(session: DocumentSession) {
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
  return documentStore.exportSvg(layout, resolved.coordinates, {
    removeGuides: !projectStore.outputSettings.keepGuides,
    removeBackground: !projectStore.outputSettings.keepBackground,
  });
}

export function useSvgExport(sessionSource?: MaybeRefOrGetter<DocumentSession | undefined>) {
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

  async function exportCurrentSvg() {
    const current = session();
    if (current) {
      const validationError = validateSessionExport(current);
      if (validationError) {
        current.documentStore.exportStatus = "error";
        current.documentStore.exportErrorMessage = validationError;
        return;
      }
      const fileName = defaultSvgName(current.documentStore.fileName);
      let selectedPath: string | undefined;
      if (isTauri()) {
        const selected = await save({
          defaultPath: fileName,
          filters: [{ name: "SVG", extensions: ["svg"] }],
        });
        if (!selected) return;
        selectedPath = selected;
      }
      try {
        const result = await generateSessionSvg(current);
        if (selectedPath) await writeFile(selectedPath, result.bytes);
        else downloadBytes(result.bytes, fileName);
      } catch (error) {
        if (current.documentStore.exportStatus === "cancelled") return;
        current.documentStore.exportStatus = "error";
        current.documentStore.exportErrorMessage =
          error instanceof Error ? error.message : "SVG 导出失败。";
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
    const selectedPath = isTauri()
      ? await save({
          defaultPath: defaultSvgName(documentStore.fileName),
          filters: [{ name: "SVG", extensions: ["svg"] }],
        })
      : undefined;
    if (isTauri() && !selectedPath) return;
    try {
      const result = await documentStore.exportSvg(layout, resolved.coordinates, {
        removeGuides: !projectStore.outputSettings.keepGuides,
        removeBackground: !projectStore.outputSettings.keepBackground,
      });
      if (selectedPath) await writeFile(selectedPath, result.bytes);
      else downloadBytes(result.bytes, defaultSvgName(documentStore.fileName));
    } catch (error) {
      if (documentStore.exportStatus === "cancelled") return;
      documentStore.exportStatus = "error";
      documentStore.exportErrorMessage =
        error instanceof Error ? error.message : "SVG 导出失败。";
    }
  }

  async function exportSelectedSvgs(entries: SvgBatchEntry[]): Promise<SvgBatchExportResult> {
    const result: SvgBatchExportResult = { cancelled: false, exported: [], errors: [] };
    const normalized = entries.map((entry) => ({
      ...entry,
      fileName: normalizeSvgName(entry.fileName, entry.session.source.fileName),
    }));
    let directory: string | undefined;
    if (isTauri()) {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择 SVG 输出目录",
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
        const generated = await generateSessionSvg(entry.session);
        if (directory) {
          await writeFile(await join(directory, entry.fileName), generated.bytes);
        } else {
          downloadBytes(generated.bytes, entry.fileName);
        }
        result.exported.push(entry.fileName);
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

  return { exportCurrentSvg, exportSelectedSvgs };
}
