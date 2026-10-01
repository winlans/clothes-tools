// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
beforeEach(() => {
  vi.resetModules(); document.head.innerHTML = ""; delete window._hmt;
  vi.stubEnv("PROD", true); vi.stubEnv("VITE_BAIDU_TONGJI_SITE_ID", "a".repeat(32));
});
afterEach(() => vi.unstubAllEnvs());
it("initializes once, uses a fixed page path and queues events before the script loads", async () => {
  const { initializeAnalytics, trackEvent } = await import("./analytics");
  initializeAnalytics(); initializeAnalytics(); trackEvent("export", "success", "plt");
  expect(document.querySelectorAll('script[src^="https://hm.baidu.com/hm.js?"]')).toHaveLength(1);
  expect(window._hmt).toEqual([
    ["_setAutoPageview", false], ["_trackPageview", "/desktop"],
    ["_trackEvent", "app", "launch", "desktop"], ["_trackEvent", "export", "success", "plt"],
  ]);
});
it("is disabled in development and without a valid site ID", async () => {
  const { initializeAnalytics, trackEvent } = await import("./analytics");
  vi.stubEnv("PROD", false); initializeAnalytics();
  vi.stubEnv("PROD", true); vi.stubEnv("VITE_BAIDU_TONGJI_SITE_ID", ""); initializeAnalytics();
  trackEvent("app", "launch"); expect(window._hmt).toBeUndefined();
  expect(document.querySelector("script")).toBeNull();
});
it("does not throw or grow an event queue after loading fails", async () => {
  const { initializeAnalytics, trackEvent } = await import("./analytics");
  initializeAnalytics(); document.getElementById("baidu-tongji")!.dispatchEvent(new Event("error"));
  expect(() => trackEvent("pdf", "import_failed")).not.toThrow();
  expect(window._hmt).toBeUndefined();
});
