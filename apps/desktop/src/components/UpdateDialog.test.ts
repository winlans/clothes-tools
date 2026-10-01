// @vitest-environment jsdom
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
import UpdateDialog from "./UpdateDialog.vue";
import { useAppUpdater } from "../composables/use-app-updater";

beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); document.body.innerHTML = ""; });
afterEach(() => { document.body.innerHTML = ""; });
it("shows version notes, disables unsafe installation and locks dismissal only during installation", async () => {
  let finishInstall!: () => void;
  const pending = {
    version: "0.1.9", currentVersion: "0.1.8", body: "修复导出\n改进排版",
    download: vi.fn(async () => {}), close: vi.fn(async () => {}),
    install: vi.fn(() => new Promise<void>((resolve) => { finishInstall = resolve; })),
  };
  mocks.check.mockResolvedValue(pending);
  const reason = ref("仍有未保存的排版修改");
  let updater!: ReturnType<typeof useAppUpdater>;
  const wrapper = mount(defineComponent({ setup() {
    updater = useAppUpdater({ installationBlockReason: () => reason.value });
    return () => h(UpdateDialog, { updater });
  } }), { attachTo: document.body });
  await updater.checkForUpdates(); await updater.downloadUpdate(); await flushPromises();
  const body = new DOMWrapper(document.body);
  expect(body.text()).toMatch(/0\.1\.8\s+→ 0\.1\.9/);
  expect(body.text()).toContain("修复导出");
  const installButton = () => body.findAll("button").find((button) => button.text().includes("重启并更新"))!;
  expect(installButton().attributes("disabled")).toBeDefined();
  reason.value = ""; await flushPromises();
  await installButton().trigger("click"); await flushPromises();
  expect(updater.state.value).toBe("installing");
  expect(body.find('[data-slot="dialog-close"]').exists()).toBe(false);
  await body.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
  updater.setDialogOpen(false); await flushPromises();
  expect(updater.dialogOpen.value).toBe(true);
  finishInstall(); await flushPromises();
  expect(mocks.relaunch).toHaveBeenCalledOnce();
  wrapper.unmount();
});
