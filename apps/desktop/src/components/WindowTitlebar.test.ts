// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  isMaximized: vi.fn(), minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(),
  startDragging: vi.fn(), onResized: vi.fn(), unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
import WindowTitlebar from "./WindowTitlebar.vue";
beforeEach(() => {
  vi.resetAllMocks();
  native.isMaximized.mockResolvedValue(false);
  native.onResized.mockResolvedValue(native.unlisten);
});
describe("custom window titlebar", () => {
  it("shows the real maximize state and responds to OS resize events", async () => {
    const wrapper = mount(WindowTitlebar); await flushPromises();
    expect(wrapper.find('[aria-label="最大化"]').exists()).toBe(true);
    native.isMaximized.mockResolvedValue(true);
    await wrapper.get('[aria-label="最大化"]').trigger("click"); await flushPromises();
    expect(native.toggleMaximize).toHaveBeenCalledOnce();
    expect(wrapper.find('[aria-label="还原窗口"]').exists()).toBe(true);
    native.isMaximized.mockResolvedValue(false);
    native.onResized.mock.calls[0]![0](); await flushPromises();
    expect(wrapper.find('[aria-label="最大化"]').exists()).toBe(true);
    wrapper.unmount(); expect(native.unlisten).toHaveBeenCalledOnce();
  });
  it("drags from title text, double-clicks once and keeps buttons out of the drag region", async () => {
    const wrapper = mount(WindowTitlebar); await flushPromises();
    wrapper.get("strong").element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
    wrapper.get("strong").element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 2 }));
    await wrapper.get('[aria-label="最小化"]').trigger("mousedown", { button: 0 });
    await wrapper.get('[aria-label="最小化"]').trigger("click");
    await wrapper.get('[aria-label="关闭"]').trigger("click");
    expect(native.startDragging).toHaveBeenCalledOnce();
    expect(native.toggleMaximize).toHaveBeenCalledOnce();
    expect(native.minimize).toHaveBeenCalledOnce();
    expect(native.close).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
  it("cleans up an event subscription that resolves after unmount", async () => {
    let subscribe!: (value: () => void) => void;
    native.onResized.mockImplementation(() => new Promise((resolve) => { subscribe = resolve; }));
    const wrapper = mount(WindowTitlebar); wrapper.unmount();
    subscribe(native.unlisten); await flushPromises();
    expect(native.unlisten).toHaveBeenCalledOnce();
  });
  it("disables close during installation and reports native command errors", async () => {
    const wrapper = mount(WindowTitlebar, { props: { closeDisabled: true } }); await flushPromises();
    await wrapper.get('[aria-label="关闭"]').trigger("click");
    expect(native.close).not.toHaveBeenCalled();
    native.minimize.mockRejectedValueOnce(new Error("native failure"));
    await wrapper.get('[aria-label="最小化"]').trigger("click"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("窗口操作失败");
    wrapper.unmount();
  });
});
