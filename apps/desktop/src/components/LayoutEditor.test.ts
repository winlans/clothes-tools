// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLayoutStore } from "../stores/layout";
import { useGuideStore } from "../stores/guides";
import { useProjectStore } from "../stores/project";
import LayoutEditor from "./LayoutEditor.vue";

const fitContent = vi.fn();
const LayoutCanvasStub = defineComponent({
  name: "LayoutCanvas",
  setup(_, { expose }) {
    expose({ fitContent });
    return () => h("div", { "data-testid": "layout-canvas" });
  },
});

describe("LayoutEditor", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fitContent.mockClear();
  });

  function mountEditor() {
    const store = useLayoutStore();
    store.initialize("pdf-1", 15);
    const wrapper = mount(LayoutEditor, {
      props: {
        pageSize: { width: 841.89, height: 1190.551 },
        previews: [],
      },
      global: { stubs: { LayoutCanvas: LayoutCanvasStub } },
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

  it("delegates fit-content to the canvas", async () => {
    const { wrapper } = mountEditor();
    const fitButton = wrapper.findAll("button").find((button) =>
      button.text().includes("适合内容"),
    );

    await fitButton?.trigger("click");
    expect(fitContent).toHaveBeenCalledOnce();
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
    expect(wrapper.text()).toContain("四条拼接线有效");
  });

  it("switches to no-seam geometry and updates output size after valid outer bounds", async () => {
    const { wrapper } = mountEditor();
    const noSeam = wrapper.findAll("button").find((button) => button.text() === "无接缝");
    await noSeam?.trigger("click");

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
    const checkboxes = wrapper.findAll('input[type="checkbox"]');

    await checkboxes[0]?.setValue(true);
    await checkboxes[1]?.setValue(true);
    await checkboxes[2]?.setValue(true);

    expect(projectStore.outputSettings).toEqual({
      keepGuides: true,
      keepBackground: true,
      allowUnusedPages: true,
    });
  });
});
