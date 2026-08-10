// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ZoomControl from "./ZoomControl.vue";

describe("ZoomControl", () => {
  it("shows and commits exactly two decimal places", async () => {
    const wrapper = mount(ZoomControl, { props: { scale: 0.86094305 } });
    const input = wrapper.get<HTMLInputElement>('input[aria-label="缩放百分比"]');

    expect(input.element.value).toBe("86.09");
    await input.setValue("37.1259");
    await input.trigger("change");

    expect(input.element.value).toBe("37.13");
    expect(wrapper.emitted("setZoom")?.at(-1)).toEqual([0.3713]);
  });
});
