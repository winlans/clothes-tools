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
});
