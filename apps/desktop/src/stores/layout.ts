import {
  addLayoutColumn,
  addLayoutRow,
  createAutomaticLayout,
  insertLayoutSpacer,
  moveLayoutPage,
  moveLayoutSpacer,
  Pdf2PltError,
  removeLastLayoutColumn,
  removeLastLayoutRow,
  removeLayoutSpacer,
  type GridPosition,
  type LayoutGrid,
} from "@pdf2plt/core";
import { defineStore } from "pinia";

export const useLayoutStore = defineStore("layout", {
  state: () => ({
    documentId: "",
    pageCount: 0,
    pagesPerColumn: 3,
    layout: undefined as LayoutGrid | undefined,
    errorMessage: "",
    past: [] as LayoutGrid[],
    future: [] as LayoutGrid[],
    nextSpacerId: 1,
  }),
  getters: {
    canUndo: (state) => state.past.length > 0,
    canRedo: (state) => state.future.length > 0,
  },
  actions: {
    initialize(documentId: string, pageCount: number) {
      if (this.documentId === documentId) return;
      this.documentId = documentId;
      this.pageCount = pageCount;
      this.pagesPerColumn = 3;
      this.errorMessage = "";
      this.layout = createAutomaticLayout(pageCount, this.pagesPerColumn);
      this.past = [];
      this.future = [];
      this.nextSpacerId = 1;
    },
    restore(documentId: string, pageCount: number, layout: LayoutGrid) {
      this.documentId = documentId;
      this.pageCount = pageCount;
      this.pagesPerColumn = layout.rows;
      this.layout = JSON.parse(JSON.stringify(layout)) as LayoutGrid;
      this.errorMessage = "";
      this.past = [];
      this.future = [];
      this.nextSpacerId = 1 + layout.cells.flat().filter((cell) => cell?.kind === "spacer").length;
    },
    applyLayoutChange(
      change: (layout: LayoutGrid) => LayoutGrid,
      fallbackMessage: string,
    ): boolean {
      if (!this.layout) return false;
      try {
        const current = this.layout;
        const next = change(current);
        if (next === current) return true;
        this.past.push(current);
        if (this.past.length > 100) this.past.shift();
        this.future = [];
        this.layout = next;
        this.errorMessage = "";
        return true;
      } catch (error) {
        this.errorMessage =
          error instanceof Pdf2PltError ? error.message : fallbackMessage;
        return false;
      }
    },
    setPagesPerColumn(value: number): boolean {
      const changed = this.applyLayoutChange(
        () => createAutomaticLayout(this.pageCount, value),
        "无法创建自动布局。",
      );
      if (changed) {
        this.pagesPerColumn = value;
      }
      return changed;
    },
    movePageTo(pageNumber: number, target: GridPosition): boolean {
      return this.applyLayoutChange(
        (layout) => moveLayoutPage(layout, pageNumber, target),
        "无法移动页面。",
      );
    },
    insertSpacer(target: GridPosition): boolean {
      const spacerId = `${this.documentId}-spacer-${this.nextSpacerId}`;
      const changed = this.applyLayoutChange(
        (layout) => insertLayoutSpacer(layout, spacerId, target),
        "无法插入空白块。",
      );
      if (changed) this.nextSpacerId += 1;
      return changed;
    },
    moveSpacerTo(spacerId: string, target: GridPosition): boolean {
      return this.applyLayoutChange(
        (layout) => moveLayoutSpacer(layout, spacerId, target),
        "无法移动空白块。",
      );
    },
    deleteSpacer(spacerId: string): boolean {
      return this.applyLayoutChange(
        (layout) => removeLayoutSpacer(layout, spacerId),
        "无法删除空白块。",
      );
    },
    addRow(): boolean {
      return this.applyLayoutChange(addLayoutRow, "无法增加布局行。");
    },
    removeLastRow(): boolean {
      return this.applyLayoutChange(removeLastLayoutRow, "无法删除布局行。");
    },
    addColumn(): boolean {
      return this.applyLayoutChange(addLayoutColumn, "无法增加布局列。");
    },
    removeLastColumn(): boolean {
      return this.applyLayoutChange(removeLastLayoutColumn, "无法删除布局列。");
    },
    undo(): boolean {
      if (!this.layout) return false;
      const previous = this.past.pop();
      if (!previous) return false;
      this.future.push(this.layout);
      this.layout = previous;
      this.errorMessage = "";
      return true;
    },
    redo(): boolean {
      if (!this.layout) return false;
      const next = this.future.pop();
      if (!next) return false;
      this.past.push(this.layout);
      if (this.past.length > 100) this.past.shift();
      this.layout = next;
      this.errorMessage = "";
      return true;
    },
    clear() {
      this.documentId = "";
      this.pageCount = 0;
      this.pagesPerColumn = 3;
      this.layout = undefined;
      this.errorMessage = "";
      this.past = [];
      this.future = [];
      this.nextSpacerId = 1;
    },
  },
});
