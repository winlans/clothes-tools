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
});
