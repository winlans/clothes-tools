// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLayoutStore } from "../stores/layout";
import { useGuideStore } from "../stores/guides";
import { usePdfDocumentStore } from "../stores/pdf-document";
import {
  DEFAULT_PREVIEW_APPEARANCE,
  usePreviewAppearanceStore,
} from "../stores/preview-appearance";
import { useProjectStore } from "../stores/project";
import LayoutEditor from "./LayoutEditor.vue";

const { setWindowFullscreen } = vi.hoisted(() => ({
  setWindowFullscreen: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFullscreen: setWindowFullscreen }),
}));

const fitContent = vi.fn();
const setZoom = vi.fn();
const requestElementFullscreen = vi.fn(() => Promise.resolve());
const LayoutCanvasStub = defineComponent({
  name: "LayoutCanvas",
  props: {
    editable: { type: Boolean, default: true },
    showGrid: { type: Boolean, default: true },
    foregroundColor: { type: String, default: "" },
    backgroundColor: { type: String, default: "" },
    lineWeight: { type: Number, default: 1 },
    rotation: { type: Number, default: 0 },
    renderRegion: { type: Function, default: undefined },
  },
  emits: ["canvasPreviewRequest"],
  setup(props, { expose }) {
    expose({ fitContent, setZoom });
    return () => h("div", {
      "data-testid": "layout-canvas",
      "data-editable": String(props.editable),
      "data-show-grid": String(props.showGrid),
      "data-foreground-color": props.foregroundColor,
      "data-background-color": props.backgroundColor,
      "data-line-weight": String(props.lineWeight),
      "data-rotation": String(props.rotation),
    });
  },
});

enableAutoUnmount(afterEach);

describe("LayoutEditor", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    fitContent.mockClear();
    setZoom.mockClear();
    setWindowFullscreen.mockClear();
    requestElementFullscreen.mockClear();
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestElementFullscreen,
    });
  });

  function mountEditor() {
    const store = useLayoutStore();
    store.initialize("pdf-1", 15);
    const wrapper = mount(LayoutEditor, {
      props: {
        pageSize: { width: 841.89, height: 1190.551 },
        previews: [],
      },
      global: { plugins: [pinia], stubs: { LayoutCanvas: LayoutCanvasStub } },
    });
    return { store, wrapper };
  }

  it("shows the default five-column by three-row layout", () => {
    const { wrapper } = mountEditor();

    expect((wrapper.get('input[type="number"]').element as HTMLInputElement).value).toBe(
      "3",
    );
    expect(wrapper.text()).toContain("5 列 × 3 行");
    expect(wrapper.find('[data-testid="layout-canvas"]').exists()).toBe(true);
  });

  it("rotates the complete preview left or right in 90-degree steps", async () => {
    const { wrapper } = mountEditor();
    const projectStore = useProjectStore();
    const canvas = wrapper.get('[data-testid="layout-canvas"]');
    const rotateLeft = wrapper.get('[aria-label="向左旋转 90 度"]');
    const rotateRight = wrapper.get('[aria-label="向右旋转 90 度"]');

    expect(canvas.attributes("data-rotation")).toBe("0");
    expect(rotateLeft.text()).toBe("");
    expect(rotateRight.text()).toBe("");
    expect(rotateLeft.find("svg").exists()).toBe(true);
    expect(rotateRight.find("svg").exists()).toBe(true);
    await rotateLeft.trigger("click");
    expect(canvas.attributes("data-rotation")).toBe("270");
    await rotateRight.trigger("click");
    await rotateRight.trigger("click");

    expect(canvas.attributes("data-rotation")).toBe("90");
    expect(projectStore.outputSettings).toMatchObject({
      rotation: 90,
    });
  });

  it("requests previews for every page shown on the layout canvas", async () => {
    const documentStore = usePdfDocumentStore();
    documentStore.requestId = 31;
    documentStore.info = {
      documentId: "pdf-1",
      pageCount: 24,
      pageSizePt: { width: 841.89, height: 1190.551 },
      pages: Array.from({ length: 24 }, (_, index) => ({
        pageNumber: index + 1,
        width: 841.89,
        height: 1190.551,
      })),
    };
    const postMessage = vi.fn();
    documentStore.worker = { postMessage } as unknown as Worker;
    const layoutStore = useLayoutStore();
    layoutStore.initialize("pdf-1", 24);

    mount(LayoutEditor, {
      props: {
        pageSize: { width: 841.89, height: 1190.551 },
        previews: [],
      },
      global: { plugins: [pinia], stubs: { LayoutCanvas: LayoutCanvasStub } },
    });
    await nextTick();

    expect(postMessage).toHaveBeenCalledWith({
      type: "request-previews",
      requestId: 31,
      pageNumbers: Array.from({ length: 24 }, (_, index) => index + 1),
    });
  });

  it("requests vector previews for visible pages after canvas movement settles", async () => {
    const requestCanvasPreviews = vi.spyOn(
      usePdfDocumentStore(),
      "requestCanvasPreviews",
    );
    const { wrapper } = mountEditor();

    wrapper.getComponent(LayoutCanvasStub).vm.$emit(
      "canvasPreviewRequest",
      [2, 3],
      3200,
    );
    await nextTick();

    expect(requestCanvasPreviews).toHaveBeenCalledWith([2, 3], 3200);
  });

  it("reflows the layout and reports invalid row counts", async () => {
    const { store, wrapper } = mountEditor();
    const input = wrapper.get('input[type="number"]');

    await input.setValue("5");
    await input.trigger("change");
    expect(store.layout).toMatchObject({ columns: 3, rows: 5 });
    expect(wrapper.text()).toContain("3 列 × 5 行");

    await input.setValue("2.5");
    await input.trigger("change");
    expect(wrapper.get('[role="alert"]').text()).toContain("正整数");
    expect(store.layout).toMatchObject({ columns: 3, rows: 5 });
  });

  it("requests a PDF reload from an icon-only refresh control", async () => {
    const { store, wrapper } = mountEditor();
    const refresh = wrapper.get('[aria-label="重新自动排列"]');

    expect(refresh.text().trim()).toBe("");
    expect(refresh.find("svg").exists()).toBe(true);
    store.addRow();
    expect(store.layout?.rows).toBe(4);

    await refresh.trigger("click");
    expect(wrapper.emitted("reload")).toHaveLength(1);
    expect(store.layout?.rows).toBe(4);
  });

  it("uses custom decrement and increment controls for pages per column", async () => {
    const { store, wrapper } = mountEditor();
    const decrement = wrapper.get('[aria-label="减少每列页数"]');
    const increment = wrapper.get('[aria-label="增加每列页数"]');

    await increment.trigger("click");
    expect(store.pagesPerColumn).toBe(4);
    expect((wrapper.get('.pages-per-column-stepper input').element as HTMLInputElement).value)
      .toBe("4");

    await decrement.trigger("click");
    expect(store.pagesPerColumn).toBe(3);
  });

  it("delegates fit-content to the canvas", async () => {
    const { wrapper } = mountEditor();
    const fitButton = wrapper.findAll("button").find((button) =>
      button.text().includes("适合内容"),
    );

    await fitButton?.trigger("click");
    expect(fitContent).toHaveBeenCalledOnce();
  });

  it("rounds zoom percentages to two decimals and supports 0.1% adjustments", async () => {
    const { wrapper } = mountEditor();
    const input = wrapper.get('.canvas-preview-actions input[aria-label="缩放百分比"]');

    await input.setValue("37.125");
    await input.trigger("change");
    expect(setZoom).toHaveBeenLastCalledWith(0.3713);

    await wrapper.get('.canvas-preview-actions [aria-label="放大 0.1%"]')
      .trigger("click");
    expect(setZoom).toHaveBeenLastCalledWith(0.3723);
  });

  it("opens a full-screen read-only preview without WebKit element fullscreen", async () => {
    const { wrapper } = mountEditor();
    const fullscreenButton = wrapper.findAll("button").find(
      (button) => button.text() === "全屏预览",
    );

    await fullscreenButton?.trigger("click");
    await flushPromises();

    const preview = wrapper.get('.fullscreen-preview[role="dialog"]');
    expect(document.body.classList.contains("fullscreen-preview-open")).toBe(true);
    expect(preview.get('[data-testid="layout-canvas"]').attributes("data-editable"))
      .toBe("false");
    expect(requestElementFullscreen).not.toHaveBeenCalled();
    expect(setWindowFullscreen).toHaveBeenCalledWith(true);
    const zoomInput = preview.get('input[aria-label="缩放百分比"]');
    await zoomInput.setValue("62.375");
    await zoomInput.trigger("change");
    expect(setZoom).toHaveBeenLastCalledWith(0.6238);

    await preview.get(".fullscreen-preview__close").trigger("click");
    await flushPromises();
    expect(wrapper.find(".fullscreen-preview").exists()).toBe(false);
    expect(document.body.classList.contains("fullscreen-preview-open")).toBe(false);
    expect(setWindowFullscreen).toHaveBeenLastCalledWith(false);
  });

  it("shares the clean-preview grid switch with fullscreen", async () => {
    const { wrapper } = mountEditor();
    const gridToggle = wrapper.get('.canvas-preview-actions input[type="checkbox"]');
    expect(wrapper.get('[data-testid="layout-canvas"]').attributes("data-show-grid"))
      .toBe("false");

    await gridToggle.setValue(true);
    expect(wrapper.get('[data-testid="layout-canvas"]').attributes("data-show-grid"))
      .toBe("true");

    const fullscreenButton = wrapper.findAll("button").find(
      (button) => button.text() === "全屏预览",
    );
    await fullscreenButton?.trigger("click");
    await flushPromises();
    expect(wrapper.get('.fullscreen-preview [data-testid="layout-canvas"]')
      .attributes("data-show-grid")).toBe("true");
    expect((wrapper.get('.fullscreen-preview .grid-visibility-toggle input')
      .element as HTMLInputElement).checked).toBe(true);
  });

  it("applies one global preview appearance and can reset its defaults", async () => {
    const { wrapper } = mountEditor();
    const appearance = usePreviewAppearanceStore();
    const foreground = wrapper.get<HTMLInputElement>('input[aria-label="预览前景色"]');
    const background = wrapper.get<HTMLInputElement>('input[aria-label="预览背景色"]');
    const lineWeight = wrapper.get<HTMLInputElement>('input[aria-label="预览线条粗细"]');

    await foreground.setValue("#123456");
    await background.setValue("#f0e0d0");
    await lineWeight.setValue("2.4");

    expect(appearance.$state).toEqual({
      foregroundColor: "#123456",
      backgroundColor: "#f0e0d0",
      lineWeight: 2.4,
    });
    expect(wrapper.get('[data-testid="layout-canvas"]').attributes())
      .toMatchObject({
        "data-foreground-color": "#123456",
        "data-background-color": "#f0e0d0",
        "data-line-weight": "2.4",
      });

    await wrapper.get(".preview-appearance-control .compact-button").trigger("click");
    expect(appearance.$state).toEqual(DEFAULT_PREVIEW_APPEARANCE);
  });

  it("lets users repair missing guides with point coordinates", async () => {
    const { wrapper } = mountEditor();
    const guideStore = useGuideStore();
    const values = [
      ["左拼接线 point 坐标", "22"],
      ["右拼接线 point 坐标", "820"],
      ["上拼接线 point 坐标", "22"],
      ["下拼接线 point 坐标", "1167"],
    ] as const;

    expect(wrapper.text()).toContain("缺少左、右、上、下方向红线");
    for (const [name, value] of values) {
      const input = wrapper.get(`[aria-label="${name}"]`);
      await input.setValue(value);
      await input.trigger("change");
    }

    expect(guideStore.canPreviewCropped).toBe(true);
    expect(guideStore.lines.left?.source).toBe("manual");
    const cropButton = wrapper.findAll("button").find((button) =>
      button.text().includes("成品裁切"),
    );
    expect(cropButton?.attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).toContain("拼接线已微调");
  });

  it("limits advanced coordinate fields to three decimal places", async () => {
    const { wrapper } = mountEditor();
    const guideStore = useGuideStore();
    guideStore.applyDetection("pdf-1", {
      lines: {
        left: { coordinatePt: 13.9994, source: "auto", supportPages: 8, pixelWeight: 800 },
        right: { coordinatePt: 826.92145, source: "auto", supportPages: 8, pixelWeight: 800 },
        top: { coordinatePt: 13.9944, source: "auto", supportPages: 8, pixelWeight: 800 },
        bottom: { coordinatePt: 1175.52649, source: "auto", supportPages: 8, pixelWeight: 800 },
      },
      missing: [],
      options: { dpi: 72, redMin: 200, otherMax: 120, redDelta: 80, minimumFraction: 0.03 },
    });
    await nextTick();

    expect(wrapper.get<HTMLInputElement>('[aria-label="左拼接线 point 坐标"]')
      .element.value).toBe("13.999");
    expect(wrapper.get<HTMLInputElement>('[aria-label="右拼接线 point 坐标"]')
      .element.value).toBe("826.921");
    expect(wrapper.get<HTMLInputElement>('[aria-label="下拼接线 point 坐标"]')
      .element.value).toBe("1175.526");
  });

  it("keeps detected seams editable without exposing a separate manual mode", async () => {
    const { wrapper } = mountEditor();
    const guideStore = useGuideStore();
    const projectStore = useProjectStore();
    guideStore.applyDetection("pdf-1", {
      lines: {
        left: { coordinatePt: 20, source: "auto", supportPages: 8, pixelWeight: 800 },
        right: { coordinatePt: 820, source: "auto", supportPages: 8, pixelWeight: 800 },
        top: { coordinatePt: 22, source: "auto", supportPages: 8, pixelWeight: 800 },
        bottom: { coordinatePt: 1167, source: "auto", supportPages: 8, pixelWeight: 800 },
      },
      missing: [],
      options: { dpi: 72, redMin: 200, otherMax: 120, redDelta: 80, minimumFraction: 0.03 },
    });
    await nextTick();

    expect(wrapper.findAll("button").some((button) => button.text() === "手动")).toBe(false);
    const left = wrapper.get('[aria-label="左拼接线 point 坐标"]');
    await left.setValue("21");
    await left.trigger("change");

    expect(projectStore.guideSettings.mode).toBe("manual");
    expect(guideStore.lines.left?.source).toBe("manual");
    expect(guideStore.lines.right?.source).toBe("auto");
  });

  it("toggles seam cropping and updates output size after valid outer bounds", async () => {
    const { wrapper } = mountEditor();
    const seamCropping = wrapper.get('[aria-label="裁切页间接缝"]');
    expect((seamCropping.element as HTMLInputElement).checked).toBe(true);
    await seamCropping.setValue(false);

    expect(wrapper.get('[aria-label="成品尺寸"]').text()).toBe("1485.00 × 1260.00 mm");
    const outerLeft = wrapper.get('[aria-label="左外边界 point 坐标"]');
    const outerRight = wrapper.get('[aria-label="右外边界 point 坐标"]');
    await outerLeft.setValue("10");
    await outerRight.setValue("800");
    await outerRight.trigger("change");

    expect(wrapper.get('[aria-label="成品尺寸"]').text()).toBe("1466.69 × 1260.00 mm");
  });

  it("persists advanced output switches in the shared project store", async () => {
    const { wrapper } = mountEditor();
    const projectStore = useProjectStore();
    const removeGuides = wrapper.get<HTMLInputElement>('[aria-label="删除红色辅助线"]');
    expect(removeGuides.element.checked).toBe(true);
    await removeGuides.setValue(false);
    await wrapper.get('[aria-label="保留白色背景"]').setValue(true);
    await wrapper.get('[aria-label="允许未使用 PDF 页"]').setValue(true);

    expect(projectStore.outputSettings).toEqual({
      keepGuides: true,
      keepBackground: true,
      allowUnusedPages: true,
      rotation: 0,
    });
  });
});
