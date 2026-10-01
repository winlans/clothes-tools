// @vitest-environment jsdom
import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

const mocks = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
import { useAppUpdater } from "./use-app-updater";

let scopes: EffectScope[] = [];
function create(blockReason = () => "") {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() => useAppUpdater({ installationBlockReason: blockReason }))!;
}
function resource() {
  return {
    version: "0.1.10", currentVersion: "0.1.9", body: "修复导出问题",
    download: vi.fn(async (_callback?: (event: DownloadEvent) => void) => {}),
    install: vi.fn(async () => {}), close: vi.fn(async () => {}),
  };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear();
  mocks.isTauri.mockReturnValue(true); mocks.relaunch.mockResolvedValue(undefined);
  mocks.check.mockResolvedValue(null);
});
afterEach(() => {
  scopes.forEach((scope) => scope.stop()); scopes = [];
  vi.useRealTimers(); vi.unstubAllEnvs();
});

describe("application updates", () => {
  it("checks after startup, downloads in the background and waits for explicit installation", async () => {
    vi.stubEnv("DEV", false);
    const pending = resource(); mocks.check.mockResolvedValue(pending);
    const updater = create(); updater.start(); updater.start();
    await vi.advanceTimersByTimeAsync(2999);
    expect(mocks.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(pending.download).toHaveBeenCalledOnce();
    expect(updater.state.value).toBe("ready");
    expect(updater.dialogOpen.value).toBe(true);
    expect(pending.install).not.toHaveBeenCalled();
    await updater.installUpdate();
    expect(pending.install).toHaveBeenCalledOnce();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("accumulates chunks, preserves unknown sizes and waits for signature verification", async () => {
    const pending = resource(); mocks.check.mockResolvedValue(pending);
    const updater = create(); await updater.checkForUpdates();
    let finish!: () => void;
    pending.download.mockImplementation(async (event) => {
      event?.({ event: "Started", data: {} });
      event?.({ event: "Progress", data: { chunkLength: 200 } });
      expect(updater.progress.value).toBeNull();
      event?.({ event: "Started", data: { contentLength: 100 } });
      event?.({ event: "Progress", data: { chunkLength: 30 } });
      event?.({ event: "Progress", data: { chunkLength: 20 } });
      expect(updater.progress.value).toBe(50);
      event?.({ event: "Finished" });
      await new Promise<void>((resolve) => { finish = resolve; });
    });
    const operation = updater.downloadUpdate();
    expect(updater.state.value).toBe("downloading");
    await updater.downloadUpdate();
    expect(pending.download).toHaveBeenCalledOnce();
    finish(); await operation;
    expect(updater.progress.value).toBe(100);
    expect(updater.state.value).toBe("ready");
  });

  it("blocks installation for unsaved work, retains downloads on failure and only retries restart after installation", async () => {
    const pending = resource(); mocks.check.mockResolvedValue(pending);
    const reason = ref("请保存修改");
    const updater = create(() => reason.value);
    await updater.checkForUpdates(); await updater.downloadUpdate();
    await updater.installUpdate();
    expect(pending.install).not.toHaveBeenCalled();
    reason.value = "";
    pending.install.mockRejectedValueOnce(new Error("disk full"));
    await updater.installUpdate();
    expect(updater.state.value).toBe("ready");
    mocks.relaunch.mockRejectedValueOnce(new Error("restart failed"));
    await updater.installUpdate();
    expect(updater.state.value).toBe("restart");
    await updater.installUpdate();
    expect(pending.download).toHaveBeenCalledOnce();
    expect(pending.install).toHaveBeenCalledTimes(2);
    expect(mocks.relaunch).toHaveBeenCalledTimes(2);
  });

  it("ignores a version across sessions but allows manual checks to offer it again", async () => {
    const pending = resource(); mocks.check.mockResolvedValue(pending);
    const updater = create(); await updater.checkForUpdates(); await updater.ignoreVersion();
    expect(pending.close).toHaveBeenCalledOnce();
    const next = create(); await next.checkForUpdates(true);
    expect(pending.download).not.toHaveBeenCalled();
    expect(next.dialogOpen.value).toBe(false);
    await next.checkForUpdates(false);
    expect(next.dialogOpen.value).toBe(true);
    expect(next.state.value).toBe("available");
  });

  it("keeps automatic check failures silent, retries and stops all timers on disposal", async () => {
    vi.stubEnv("DEV", false);
    mocks.check.mockRejectedValue(new Error("offline"));
    const updater = create(); updater.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(updater.dialogOpen.value).toBe(false);
    expect(updater.state.value).toBe("error");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.check).toHaveBeenCalledTimes(2);
    scopes[0]!.stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it("disposes results that arrive after unmount and never proxies native resources", async () => {
    class NativeUpdate {
      #valid = true;
      version = "0.1.10";
      async close() { expect(this.#valid).toBe(true); }
      async download() { expect(this.#valid).toBe(true); }
    }
    const native = new NativeUpdate() as unknown as Update;
    mocks.check.mockResolvedValueOnce(native);
    const updater = create(); await updater.checkForUpdates(); await updater.downloadUpdate();
    expect(updater.state.value).toBe("ready");
    const late = resource();
    let finish!: (value: unknown) => void;
    mocks.check.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const next = create(); const check = next.checkForUpdates();
    scopes[1]!.stop(); finish(late); await check;
    expect(late.close).toHaveBeenCalledOnce();
    expect(next.update.value).toBeNull();
  });

  it("does not auto-update development builds or call desktop APIs in a browser", async () => {
    vi.stubEnv("DEV", true);
    create().start(); await vi.advanceTimersByTimeAsync(3_600_000);
    mocks.isTauri.mockReturnValue(false);
    const updater = create(); updater.start(); await updater.checkForUpdates();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(updater.error.value).toContain("桌面应用");
  });
});
