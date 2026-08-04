// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLayoutStore } from "../stores/layout";
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
});
