import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useLayoutStore } from "./layout";

describe("layout store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("initializes a document with three pages per column", () => {
    const store = useLayoutStore();
    store.initialize("pdf-1", 15);

    expect(store.pagesPerColumn).toBe(3);
    expect(store.layout).toMatchObject({ rows: 3, columns: 5 });
  });

  it("keeps the previous layout when a new value is invalid", () => {
    const store = useLayoutStore();
    store.initialize("pdf-1", 15);

    expect(store.setPagesPerColumn(2.5)).toBe(false);
    expect(store.layout).toMatchObject({ rows: 3, columns: 5 });
    expect(store.errorMessage).toContain("正整数");
  });

  it("commits stable page moves without duplicates", () => {
    const store = useLayoutStore();
    store.initialize("pdf-1", 6);

    expect(store.movePageTo(2, { row: 1, column: 1 })).toBe(true);
    const pageNumbers = store.layout?.cells
      .flat()
      .flatMap((cell) => (cell?.kind === "page" ? [cell.pageNumber] : []));
    expect(pageNumbers?.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("undoes and redoes page moves, spacers, and expansion", () => {
    const store = useLayoutStore();
    store.initialize("pdf-1", 6);
    store.insertSpacer({ row: 0, column: 0 });

    expect(store.layout?.columns).toBe(3);
    expect(store.canUndo).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.layout?.columns).toBe(2);
    expect(store.redo()).toBe(true);
    expect(store.layout?.columns).toBe(3);

    store.undo();
    store.movePageTo(1, { row: 1, column: 0 });
    expect(store.canRedo).toBe(false);
  });

  it("limits history to 100 entries and resets it for a new document", () => {
    const store = useLayoutStore();
    store.initialize("pdf-1", 3);
    for (let index = 0; index < 105; index += 1) store.addColumn();

    expect(store.past).toHaveLength(100);
    store.initialize("pdf-2", 3);
    expect(store.past).toHaveLength(0);
    expect(store.future).toHaveLength(0);
  });
});
