// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";

import App from "./App.vue";
import { useLayoutStore } from "./stores/layout";
import { usePdfDocumentStore } from "./stores/pdf-document";

describe("App", () => {
  it("offers local import and the required legal notice", async () => {
    setActivePinia(createPinia());
    const wrapper = mount(App, { global: { plugins: [createPinia()] } });
    expect(wrapper.findAll("button").map((button) => button.text())).toEqual([
      "关于与许可证",
      "打开工程",
      "打开 PDF",
    ]);
    expect(wrapper.text()).toContain("不会上传到网络");
    await wrapper.findAll("button")[0]?.trigger("click");
    expect(wrapper.get('[role="dialog"]').text()).toContain("AGPL-3.0-or-later");
    expect(wrapper.get('[role="dialog"]').text()).toContain("本软件不提供任何担保");
  });

  it("applies the detected pages per column to an untouched new layout", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(App, { global: { plugins: [pinia] } });
    const documentStore = usePdfDocumentStore();
    const layoutStore = useLayoutStore();
    documentStore.info = {
      documentId: "pdf-8",
      pageCount: 8,
      pageSizePt: { width: 1190, height: 842 },
      pages: Array.from({ length: 8 }, (_, index) => ({
        pageNumber: index + 1,
        width: 1190,
        height: 842,
      })),
    };
    await nextTick();
    expect(layoutStore.pagesPerColumn).toBe(3);

    documentStore.guideDetection = {
      lines: {},
      missing: ["left", "right", "top", "bottom"],
      options: { dpi: 72, redMin: 200, otherMax: 120, redDelta: 80, minimumFraction: 0.03 },
      inferredPagesPerColumn: 4,
    };
    await nextTick();

    expect(layoutStore.pagesPerColumn).toBe(4);
    expect(layoutStore.layout).toMatchObject({ rows: 4, columns: 2 });
    wrapper.unmount();
  });
});
