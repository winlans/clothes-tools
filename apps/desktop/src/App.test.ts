// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import App from "./App.vue";

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
});
