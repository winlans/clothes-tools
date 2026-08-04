import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

import { useResolvedSettings } from "./use-resolved-settings";
import { useLayoutStore } from "../stores/layout";
import { usePdfDocumentStore } from "../stores/pdf-document";
import { useProjectStore } from "../stores/project";

function outputName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "") + ".svg";
}

export function useSvgExport() {
  const documentStore = usePdfDocumentStore();
  const layoutStore = useLayoutStore();
  const projectStore = useProjectStore();
  const settings = useResolvedSettings(() => documentStore.info?.pageSizePt);

  async function exportCurrentSvg() {
    const layout = layoutStore.layout;
    if (!layout) return;
    const resolved = settings.resolved.value.value;
    if (!resolved || !settings.canExport.value) {
      documentStore.exportStatus = "error";
      documentStore.exportErrorMessage = settings.validationError.value || "当前设置无法导出。";
      return;
    }
    let selectedPath: string | undefined;
    if (isTauri()) {
      const selected = await save({
        defaultPath: outputName(documentStore.fileName),
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
      if (!selected) return;
      selectedPath = selected;
    }

    try {
      const result = await documentStore.exportSvg(layout, resolved.coordinates, {
        removeGuides: !projectStore.outputSettings.keepGuides,
        removeBackground: !projectStore.outputSettings.keepBackground,
      });
      if (selectedPath) {
        await writeFile(selectedPath, result.bytes);
        return;
      }
      const url = URL.createObjectURL(new Blob([result.bytes], { type: "image/svg+xml" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = outputName(documentStore.fileName);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      if (documentStore.exportStatus === "cancelled") return;
      if (!documentStore.exportErrorMessage) {
        documentStore.exportErrorMessage =
          error instanceof Error ? error.message : "SVG 导出失败。";
        documentStore.exportStatus = "error";
      }
    }
  }

  return { exportCurrentSvg };
}
