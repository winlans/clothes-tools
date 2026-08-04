import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

import { usePdfDocumentStore } from "../stores/pdf-document";

export function usePdfImport() {
  const documentStore = usePdfDocumentStore();

  async function openTauriPdf() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;
    const bytes = await readFile(selected);
    const fileName = selected.split(/[\\/]/).at(-1) ?? selected;
    await documentStore.open(bytes, fileName, selected);
  }

  async function openBrowserPdf(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await documentStore.open(bytes, file.name);
  }

  return {
    isDesktop: isTauri(),
    openTauriPdf,
    openBrowserPdf,
  };
}
