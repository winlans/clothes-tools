// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import PageSidebar from "./PageSidebar.vue";

describe("PageSidebar", () => {
  it("starts collapsed and exposes an accessible expand control", async () => {
    const wrapper = mount(PageSidebar, {
      props: {
        collapsed: true,
        pages: [{ pageNumber: 1, width: 842, height: 1190 }],
        previews: {},
      },
    });

    expect(wrapper.findAll(".page-thumbnail")).toHaveLength(0);
    await wrapper.get('[aria-label="展开页面栏"]').trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);

    await wrapper.setProps({ collapsed: false });
    expect(wrapper.findAll(".page-thumbnail")).toHaveLength(1);
    expect(wrapper.find('[aria-label="收起页面栏"]').exists()).toBe(true);
  });
});
