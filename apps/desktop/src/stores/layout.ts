import { createAutomaticLayout, Pdf2PltError, type LayoutGrid } from "@pdf2plt/core";
import { defineStore } from "pinia";

export const useLayoutStore = defineStore("layout", {
  state: () => ({
    documentId: "",
    pageCount: 0,
    pagesPerColumn: 3,
    layout: undefined as LayoutGrid | undefined,
    errorMessage: "",
  }),
  actions: {
    initialize(documentId: string, pageCount: number) {
      if (this.documentId === documentId) return;
      this.documentId = documentId;
      this.pageCount = pageCount;
      this.pagesPerColumn = 3;
      this.errorMessage = "";
      this.layout = createAutomaticLayout(pageCount, this.pagesPerColumn);
    },
    setPagesPerColumn(value: number): boolean {
      try {
        this.layout = createAutomaticLayout(this.pageCount, value);
        this.pagesPerColumn = value;
        this.errorMessage = "";
        return true;
      } catch (error) {
        this.errorMessage =
          error instanceof Pdf2PltError ? error.message : "无法创建自动布局。";
        return false;
      }
    },
    clear() {
      this.documentId = "";
      this.pageCount = 0;
      this.pagesPerColumn = 3;
      this.layout = undefined;
      this.errorMessage = "";
    },
  },
});
