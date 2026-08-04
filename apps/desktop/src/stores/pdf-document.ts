import type { PdfDocumentInfo } from "@pdf2plt/core";
import { defineStore } from "pinia";
import { markRaw } from "vue";

import type { PdfWorkerRequest, PdfWorkerResponse } from "../workers/protocol";

interface PreviewState {
  pageNumber: number;
  width: number;
  height: number;
  url: string;
}

type DocumentStatus = "idle" | "loading" | "ready" | "error";

export const usePdfDocumentStore = defineStore("pdf-document", {
  state: () => ({
    status: "idle" as DocumentStatus,
    fileName: "",
    sourcePath: undefined as string | undefined,
    info: undefined as PdfDocumentInfo | undefined,
    previews: {} as Record<number, PreviewState>,
    progress: { completed: 0, total: 0 },
    errorMessage: "",
    worker: undefined as Worker | undefined,
    requestId: 0,
  }),
  getters: {
    previewList(state): PreviewState[] {
      return Object.values(state.previews).sort((a, b) => a.pageNumber - b.pageNumber);
    },
  },
  actions: {
    ensureWorker() {
      if (this.worker) return;
      this.worker = markRaw(
        new Worker(new URL("../workers/pdf.worker.ts", import.meta.url), {
          type: "module",
        }),
      );
      this.worker.onmessage = (event: MessageEvent<PdfWorkerResponse>) => {
        this.handleWorkerMessage(event.data);
      };
      this.worker.onerror = (event) => {
        this.status = "error";
        this.errorMessage = event.message || "PDF Worker 启动失败。";
      };
    },
    async open(bytes: Uint8Array<ArrayBuffer>, fileName: string, sourcePath?: string) {
      this.disposePreviews();
      this.ensureWorker();
      this.requestId += 1;
      this.status = "loading";
      this.fileName = fileName;
      this.sourcePath = sourcePath;
      this.info = undefined;
      this.errorMessage = "";
      this.progress = { completed: 0, total: 0 };
      const request: PdfWorkerRequest = {
        type: "open",
        requestId: this.requestId,
        bytes,
        previewLongEdge: 1600,
      };
      this.worker?.postMessage(request, [bytes.buffer]);
    },
    handleWorkerMessage(message: PdfWorkerResponse) {
      if (message.requestId !== this.requestId) return;
      if (message.type === "document") {
        this.info = message.info;
        this.progress = { completed: 0, total: message.info.pageCount };
        return;
      }
      if (message.type === "preview") {
        const blob = new Blob([message.bytes], { type: "image/png" });
        this.previews[message.pageNumber] = {
          pageNumber: message.pageNumber,
          width: message.width,
          height: message.height,
          url: URL.createObjectURL(blob),
        };
        return;
      }
      if (message.type === "progress") {
        this.progress = { completed: message.completed, total: message.total };
        return;
      }
      if (message.type === "complete") {
        if (this.info) this.status = "ready";
        return;
      }
      this.status = "error";
      this.errorMessage = message.message;
    },
    close() {
      this.requestId += 1;
      const request: PdfWorkerRequest = { type: "close", requestId: this.requestId };
      this.worker?.postMessage(request);
      this.disposePreviews();
      this.status = "idle";
      this.fileName = "";
      this.sourcePath = undefined;
      this.info = undefined;
      this.errorMessage = "";
      this.progress = { completed: 0, total: 0 };
    },
    disposePreviews() {
      for (const preview of Object.values(this.previews)) {
        URL.revokeObjectURL(preview.url);
      }
      this.previews = {};
    },
    dispose() {
      this.close();
      this.worker?.terminate();
      this.worker = undefined;
    },
  },
});
