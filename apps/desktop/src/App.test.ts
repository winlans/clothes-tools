// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";

import App from "./App.vue";
import { createDocumentSession } from "./stores/document-session";
import { useWorkspaceStore } from "./stores/workspace";

describe("App", () => {
  it("offers local import and the required legal notice", async () => {
    setActivePinia(createPinia());
    const wrapper = mount(App, { global: { plugins: [createPinia()] } });
    expect(wrapper.findAll("button").map((button) => button.text())).toEqual([
      "关于与许可证",
      "打开 PDF",
    ]);
    expect(wrapper.text()).not.toContain("打开工程");
    expect(wrapper.text()).not.toContain("保存工程");
    expect(wrapper.text()).toContain("不会上传到网络");
    await wrapper.findAll("button")[0]?.trigger("click");
    expect(wrapper.get('[role="dialog"]').text()).toContain("AGPL-3.0-or-later");
    expect(wrapper.get('[role="dialog"]').text()).toContain("本软件不提供任何担保");
  });

  it("applies the detected pages per column to an untouched new layout", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(App, { global: { plugins: [pinia] } });
    const workspace = useWorkspaceStore(pinia);
    const session = createDocumentSession("test-tab", {
      fileName: "sample.pdf",
      sourceKey: "path:/tmp/sample.pdf",
      sourcePath: "/tmp/sample.pdf",
      load: () => Promise.reject(new Error("not used")),
    });
    session.ui.loadStatus = "error";
    workspace.tabs = [session];
    workspace.activate(session.id);
    const { documentStore, layoutStore } = session;
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
    expect(wrapper.find(".document-summary").exists()).toBe(false);
    expect(wrapper.get(".topbar__document").text()).toContain("8 页");
    expect(wrapper.get(".topbar__document").text()).toContain("1190.000 × 842.000 pt");

    documentStore.guideDetection = {
      lines: {},
      missing: ["left", "right", "top", "bottom"],
      options: { dpi: 72, redMin: 200, otherMax: 120, redDelta: 80, minimumFraction: 0.03 },
      inferredPagesPerColumn: 4,
      inferredLayout: {
        pagesPerColumn: 4,
        columns: [
          [1, 2, 3, 4],
          [5, 6, 7, 8],
        ],
      },
    };
    await nextTick();

    expect(layoutStore.pagesPerColumn).toBe(4);
    expect(layoutStore.layout).toMatchObject({ rows: 4, columns: 2 });
    wrapper.unmount();
  });
});
