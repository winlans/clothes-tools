import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ref } from "vue";

import { sha256Hex } from "../project/fingerprint";
import type { PdfImportCandidate } from "../stores/document-session";
import { useWorkspaceStore, type BatchImportResult } from "../stores/workspace";

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name);
}

function resultMessage(result: BatchImportResult): string {
  const parts: string[] = [];
  if (result.duplicates) parts.push(`${result.duplicates} 个已打开文件已定位`);
  if (result.skipped) parts.push(`跳过 ${result.skipped} 个非 PDF`);
  if (result.failed) parts.push(`${result.failed} 个文件无法读取`);
  return parts.join("，");
}

export function usePdfImport() {
  const workspace = useWorkspaceStore();
  const desktop = isTauri();
  const dropActive = ref(false);
  const dropCount = ref(0);
  const importNotice = ref("");
  let unlistenDragDrop: (() => void) | undefined;

  function publishResult(result: BatchImportResult) {
    importNotice.value = resultMessage(result);
  }

  async function desktopCandidate(path: string): Promise<PdfImportCandidate> {
    const canonical = await invoke<string>("allow_pdf_read_scope", { path });
    return {
      fileName: fileNameFromPath(canonical),
      sourceKey: `path:${canonical}`,
      sourcePath: canonical,
      load: () => readFile(canonical),
    };
  }

  async function openDesktopPaths(paths: string[]) {
    const pdfPaths = paths.filter(isPdfName);
    const settled = await Promise.allSettled(pdfPaths.map(desktopCandidate));
    const candidates = settled
      .filter((entry): entry is PromiseFulfilledResult<PdfImportCandidate> => entry.status === "fulfilled")
      .map((entry) => entry.value);
    const result = workspace.enqueueCandidates(candidates);
    result.skipped = paths.length - pdfPaths.length;
    result.failed = settled.filter((entry) => entry.status === "rejected").length;
    publishResult(result);
    return result;
  }

  async function openTauriPdfs() {
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;
    await openDesktopPaths(Array.isArray(selected) ? selected : [selected]);
  }

  function browserCandidate(file: File, sha256: string): PdfImportCandidate {
    return {
      fileName: file.name,
      sourceKey: `sha256:${sha256}`,
      load: async () => new Uint8Array(await file.arrayBuffer()),
    };
  }

  async function openBrowserPdfs(files: File[]) {
    const pdfFiles = files.filter((file) => isPdfName(file.name));
    const candidates: PdfImportCandidate[] = [];
    let failed = 0;
    for (const file of pdfFiles) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        candidates.push(browserCandidate(file, await sha256Hex(bytes)));
      } catch {
        failed += 1;
      }
    }
    const result = workspace.enqueueCandidates(candidates);
    result.skipped = files.length - pdfFiles.length;
    result.failed = failed;
    publishResult(result);
    return result;
  }

  async function choosePdfs() {
    if (desktop) await openTauriPdfs();
  }

  async function startNativeDragDrop() {
    if (!desktop || unlistenDragDrop) return;
    unlistenDragDrop = await getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter") {
        dropCount.value = payload.paths.filter(isPdfName).length;
        dropActive.value = payload.paths.length > 0;
      } else if (payload.type === "drop") {
        dropActive.value = false;
        dropCount.value = 0;
        void openDesktopPaths(payload.paths);
      } else if (payload.type === "leave") {
        dropActive.value = false;
        dropCount.value = 0;
      }
    });
  }

  function stopNativeDragDrop() {
    unlistenDragDrop?.();
    unlistenDragDrop = undefined;
  }

  function handleBrowserDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    dropCount.value = event.dataTransfer.items.length;
    dropActive.value = true;
  }

  function handleBrowserDragLeave(event: DragEvent) {
    const related = event.relatedTarget;
    if (related instanceof Node && (event.currentTarget as Node | null)?.contains(related)) return;
    dropActive.value = false;
    dropCount.value = 0;
  }

  function handleBrowserDrop(event: DragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dropActive.value = false;
    dropCount.value = 0;
    void openBrowserPdfs([...event.dataTransfer.files]);
  }

  return {
    isDesktop: desktop,
    dropActive,
    dropCount,
    importNotice,
    choosePdfs,
    openTauriPdfs,
    openDesktopPaths,
    openBrowserPdfs,
    startNativeDragDrop,
    stopNativeDragDrop,
    handleBrowserDragOver,
    handleBrowserDragLeave,
    handleBrowserDrop,
  };
}
