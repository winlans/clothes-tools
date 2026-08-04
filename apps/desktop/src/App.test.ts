// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import App from "./App.vue";

describe("App", () => {
  it("offers a local PDF import action", () => {
    setActivePinia(createPinia());
    const wrapper = mount(App, { global: { plugins: [createPinia()] } });
    expect(wrapper.findAll("button").map((button) => button.text())).toEqual([
      "打开工程",
      "打开 PDF",
    ]);
    expect(wrapper.text()).toContain("不会上传到网络");
  });
});
