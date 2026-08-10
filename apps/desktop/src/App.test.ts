// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";

import App from "./App.vue";
import { createDocumentSession } from "./stores/document-session";
import { useWorkspaceStore } from "./stores/workspace";

describe("App", () => {
  it("does not treat an internal sidebar drag as a PDF file import", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(App, { global: { plugins: [pinia] } });
    const dataTransfer = {
      types: ["Files", "application/x-pdf2plt-spacer"],
      items: [{ kind: "string", type: "application/x-pdf2plt-spacer" }],
      files: [],
      dropEffect: "none",
    };

    await wrapper.get("main").trigger("dragover", { dataTransfer });

    expect(wrapper.find(".file-drop-overlay").exists()).toBe(false);

    await wrapper.get("main").trigger("dragover", {
      dataTransfer: {
        types: ["Files"],
        items: [{ kind: "file", type: "application/pdf" }],
        files: [],
        dropEffect: "none",
      },
    });
    expect(wrapper.find(".file-drop-overlay").exists()).toBe(true);
    wrapper.unmount();
  });

  it("offers local import and the required legal notice", async () => {
    setActivePinia(createPinia());
    const wrapper = mount(App, { global: { plugins: [createPinia()] } });
    expect(wrapper.findAll("button").slice(0, 4).map((button) => button.text())).toEqual([
      "打开 PDF",
      "导出 ⌄",
      "关闭标签",
      "更多 ⌄",
    ]);
    const emptyImport = wrapper.get('[aria-label="选择 PDF 文件导入"]');
    expect(emptyImport.text()).toContain("导入分块版图");
    const fileInput = wrapper.get<HTMLInputElement>('input[type="file"]');
    const inputClick = vi.spyOn(fileInput.element, "click").mockImplementation(() => undefined);
    await emptyImport.trigger("click");
    expect(inputClick).toHaveBeenCalledOnce();
    expect(wrapper.text()).not.toContain("打开工程");
    expect(wrapper.text()).not.toContain("保存工程");
    expect(wrapper.text()).toContain("不会上传到网络");
    await wrapper.findAll("button")[3]?.trigger("click");
    const about = wrapper.findAll("button").find((button) =>
      button.text().includes("关于与许可证"),
    );
    await about?.trigger("click");
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
    const topChrome = wrapper.get(".app-top-chrome");
    expect(topChrome.find(".app-commandbar").exists()).toBe(true);
    expect(topChrome.find(".document-tabs").exists()).toBe(true);
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

  it("reloads the PDF source when automatic arrangement is refreshed", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(App, {
      global: { plugins: [pinia], stubs: { LayoutCanvas: true } },
    });
    const workspace = useWorkspaceStore(pinia);
    const load = vi.fn(() => new Promise<Uint8Array<ArrayBuffer>>(() => undefined));
    const session = createDocumentSession("refresh-tab", {
      fileName: "sample.pdf",
      sourceKey: "path:/tmp/sample.pdf",
      sourcePath: "/tmp/sample.pdf",
      load,
    });
    session.ui.loadStatus = "ready";
    session.ui.dirty = true;
    session.documentStore.status = "ready";
    session.documentStore.info = {
      documentId: "pdf-refresh",
      pageCount: 4,
      pageSizePt: { width: 841.89, height: 1190.551 },
      pages: Array.from({ length: 4 }, (_, index) => ({
        pageNumber: index + 1,
        width: 841.89,
        height: 1190.551,
      })),
    };
    workspace.tabs = [session];
    workspace.activate(session.id);
    await nextTick();

    await wrapper.get('[aria-label="重新自动排列"]').trigger("click");

    expect(load).toHaveBeenCalledOnce();
    expect(session.ui.loadStatus).toBe("loading");
    expect(session.ui.dirty).toBe(false);
    expect(session.documentStore.info).toBeUndefined();
    wrapper.unmount();
  });

  it("scrolls overflowing document tabs horizontally with the mouse wheel", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(App, { global: { plugins: [pinia] } });
    const workspace = useWorkspaceStore(pinia);
    const sessions = ["first.pdf", "second.pdf"].map((fileName, index) => {
      const session = createDocumentSession(`wheel-tab-${index}`, {
        fileName,
        sourceKey: `path:/tmp/${fileName}`,
        sourcePath: `/tmp/${fileName}`,
        load: () => Promise.reject(new Error("not used")),
      });
      session.ui.loadStatus = "error";
      return session;
    });
    workspace.tabs = sessions;
    workspace.activate(sessions[0]!.id);
    await nextTick();

    const tabs = wrapper.get<HTMLElement>(".document-tabs");
    Object.defineProperties(tabs.element, {
      clientWidth: { configurable: true, value: 200 },
      scrollWidth: { configurable: true, value: 600 },
    });
    const wheel = new WheelEvent("wheel", { cancelable: true, deltaY: 120 });
    tabs.element.dispatchEvent(wheel);

    expect(tabs.element.scrollLeft).toBe(120);
    expect(wheel.defaultPrevented).toBe(true);
    wrapper.unmount();
  });

  it("lets users select and rename tabs for multi-document SVG and PLT exports", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(App, { global: { plugins: [pinia] } });
    const workspace = useWorkspaceStore(pinia);
    const sessions = ["sample.pdf", "sample.PDF"].map((fileName, index) => {
      const session = createDocumentSession(`export-tab-${index}`, {
        fileName,
        sourceKey: `path:/tmp/${index}-${fileName}`,
        sourcePath: `/tmp/${fileName}`,
        load: () => Promise.reject(new Error("not used")),
      });
      session.ui.loadStatus = "error";
      session.documentStore.info = {
        documentId: `export-pdf-${index}`,
        pageCount: 1,
        pageSizePt: { width: 842, height: 1190 },
        pages: [{ pageNumber: 1, width: 842, height: 1190 }],
      };
      session.projectStore.setGuideSettings({
        ...session.projectStore.guideSettings,
        mode: "none",
      });
      return session;
    });
    workspace.tabs = sessions;
    workspace.activate(sessions[0]!.id);
    await nextTick();

    const exportButton = wrapper.findAll("button").find((button) =>
      button.text().trim() === "导出 ⌄",
    );
    expect(exportButton?.attributes("disabled")).toBeUndefined();
    await exportButton?.trigger("click");
    const exportSvg = wrapper.findAll("button").find((button) =>
      button.text().includes("导出 SVG"),
    );
    await exportSvg?.trigger("click");

    const dialog = wrapper.get(".export-dialog");
    expect(dialog.text()).toContain("选择要导出的标签");
    const checkboxes = dialog.findAll<HTMLInputElement>('.export-tab-row__checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((checkbox) => checkbox.element.checked)).toBe(true);
    const fileNames = dialog.findAll<HTMLInputElement>('.export-tab-row__filename input');
    expect(fileNames.map((input) => input.element.value)).toEqual([
      "sample.svg",
      "sample-2.svg",
    ]);

    await fileNames[0]?.setValue("客户版");
    await fileNames[0]?.trigger("blur");
    expect(fileNames[0]?.element.value).toBe("客户版.svg");
    expect(dialog.get(".primary-button").text()).toContain("导出（2）");

    await dialog.get('.export-dialog__close').trigger("click");
    await exportButton?.trigger("click");
    const exportPlt = wrapper.findAll("button").find((button) =>
      button.text().includes("导出 PLT"),
    );
    await exportPlt?.trigger("click");
    const pltDialog = wrapper.get(".export-dialog");
    expect(pltDialog.text()).toContain("PLT");
    expect(pltDialog.findAll<HTMLInputElement>('.export-tab-row__filename input')
      .map((input) => input.element.value)).toEqual(["sample.plt", "sample-2.plt"]);
    wrapper.unmount();
  });
});
