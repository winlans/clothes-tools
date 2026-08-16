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

  it("calculates a calibrated zoom and applies it only after confirmation", async () => {
    const wrapper = mount(ZoomControl, { props: { scale: 0.8 } });
    const calculatorButton = wrapper.get('[aria-label="自动计算缩放比例"]');

    expect(calculatorButton.attributes("title")).toBe("自动计算缩放比例");
    await calculatorButton.trigger("click");
    await wrapper.get('input[aria-label="校对块尺寸"]').setValue("100");
    await wrapper.get('input[aria-label="投放尺寸"]').setValue("120");

    expect(wrapper.get(".zoom-calculator__result").text()).toContain("96.00%");
    expect(wrapper.emitted("setZoom")).toBeUndefined();

    await wrapper.get('.zoom-calculator__actions button[type="submit"]').trigger("submit");
    expect(wrapper.emitted("setZoom")?.at(-1)).toEqual([0.96]);
    expect(wrapper.find(".zoom-calculator").exists()).toBe(false);
  });

  it("rejects invalid dimensions and calculated zoom outside the supported range", async () => {
    const wrapper = mount(ZoomControl, { props: { scale: 1 } });
    await wrapper.get('[aria-label="自动计算缩放比例"]').trigger("click");

    const calibration = wrapper.get('input[aria-label="校对块尺寸"]');
    const placement = wrapper.get('input[aria-label="投放尺寸"]');
    const apply = wrapper.get<HTMLButtonElement>(
      '.zoom-calculator__actions button[type="submit"]',
    );

    await calibration.setValue("0");
    await placement.setValue("10");
    expect(wrapper.get(".zoom-calculator__result").text()).toContain("大于 0");
    expect(apply.element.disabled).toBe(true);

    await calibration.setValue("1");
    await placement.setValue("5");
    expect(wrapper.get(".zoom-calculator__result").text()).toContain("10% 至 400%");
    expect(apply.element.disabled).toBe(true);
  });
});
