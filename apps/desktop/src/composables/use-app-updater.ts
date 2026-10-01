import { computed, onScopeDispose, ref, shallowRef } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { trackEvent } from "../lib/analytics";

export type UpdateState = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "restart" | "up-to-date" | "error";
const IGNORED_VERSION_KEY = "clothes-tools:ignored-update-version";
const RETRY_DELAYS = [60_000, 300_000, 900_000];

export function useAppUpdater(options: { installationBlockReason?: () => string } = {}) {
  const desktop = isTauri();
  const state = ref<UpdateState>("idle");
  // Update is a native resource with private fields; Vue must not proxy it.
  const update = shallowRef<Update | null>(null);
  const error = ref("");
  const progress = ref<number | null>(null);
  const dialogOpen = ref(false);
  const ignoredVersion = ref("");
  try { ignoredVersion.value = localStorage.getItem(IGNORED_VERSION_KEY) ?? ""; } catch { /* Storage may be unavailable. */ }
  const isInstalling = computed(() => state.value === "installing");
  const busy = computed(() => ["checking", "downloading", "installing"].includes(state.value));
  const hasUpdate = computed(() => Boolean(update.value) && update.value?.version !== ignoredVersion.value);
  const installationBlockReason = computed(() => options.installationBlockReason?.() ?? "");
  let disposed = false;
  let started = false;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let notifiedVersion = "";

  async function release(resource: Update | null) {
    try { await resource?.close(); } catch { /* Do not mask the original update error. */ }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (!started || disposed || retryCount >= RETRY_DELAYS.length) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void checkForUpdates(true);
    }, RETRY_DELAYS[retryCount++]);
  }

  async function checkForUpdates(silent = false) {
    if (disposed) return null;
    if (!silent) dialogOpen.value = true;
    if (!desktop) {
      error.value = "请在桌面应用中检查和安装更新。";
      return null;
    }
    if (busy.value || state.value === "restart" || state.value === "ready") return update.value;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    state.value = "checking";
    error.value = "";
    trackEvent("update", "check", silent ? "automatic" : "manual");
    try {
      const result = await check({ timeout: 20_000 });
      if (disposed) { await release(result); return null; }
      const previous = update.value;
      update.value = result;
      if (previous !== result) await release(previous);
      if (disposed) return null;
      state.value = result ? "available" : "up-to-date";
      if (!result) retryCount = 0;
      if (result) {
        trackEvent("update", "available");
        if (silent && result.version !== ignoredVersion.value) await downloadUpdate(true);
      }
      return result;
    } catch {
      if (disposed) return null;
      state.value = "error";
      error.value = "暂时无法检查更新，请检查网络连接后重试。";
      trackEvent("update", "check_failed");
      scheduleRetry();
      return null;
    }
  }

  async function downloadUpdate(automatic = false) {
    const pending = update.value;
    if (disposed || !pending || busy.value || state.value === "ready" || state.value === "restart") return;
    state.value = "downloading";
    clearTimeout(retryTimer);
    retryTimer = undefined;
    error.value = "";
    progress.value = null;
    let downloaded = 0;
    let contentLength = 0;
    trackEvent("update", "download");
    try {
      await pending.download((event) => {
        if (disposed) return;
        if (event.event === "Started") {
          downloaded = 0;
          contentLength = event.data.contentLength ?? 0;
          progress.value = contentLength > 0 ? 0 : null;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) progress.value = Math.min(100, Math.round(downloaded / contentLength * 100));
        }
        // Transfer completion precedes signature verification; await download().
      }, { timeout: 120_000 });
      if (disposed) { await release(pending); return; }
      state.value = "ready";
      progress.value = 100;
      retryCount = 0;
      trackEvent("update", "downloaded");
      if (automatic && notifiedVersion !== pending.version) {
        notifiedVersion = pending.version;
        dialogOpen.value = true;
      }
    } catch {
      if (disposed) return;
      state.value = "available";
      error.value = "下载或验证更新失败，请检查网络后重试。";
      trackEvent("update", "download_failed");
      if (automatic) scheduleRetry();
    }
  }

  async function installUpdate() {
    if (disposed || (state.value !== "ready" && state.value !== "restart")) return;
    if (installationBlockReason.value) {
      error.value = installationBlockReason.value;
      dialogOpen.value = true;
      return;
    }
    let installed = state.value === "restart";
    state.value = "installing";
    error.value = "";
    dialogOpen.value = true;
    clearTimeout(retryTimer);
    trackEvent("update", "install");
    try {
      if (!installed) {
        await update.value!.install();
        installed = true;
      }
      // Windows exits from install(); its installer relaunches the application.
      await relaunch();
      state.value = "restart";
    } catch {
      state.value = installed ? "restart" : "ready";
      error.value = installed
        ? "更新已安装，但重启失败。请重试或手动重新打开应用。"
        : "安装更新失败，请稍后重试。";
      trackEvent("update", installed ? "restart_failed" : "install_failed");
    }
  }

  function setDialogOpen(open: boolean) {
    if (!open && isInstalling.value) return;
    dialogOpen.value = open;
  }

  async function ignoreVersion() {
    if (busy.value || state.value === "restart" || !update.value) return;
    ignoredVersion.value = update.value.version;
    try { localStorage.setItem(IGNORED_VERSION_KEY, ignoredVersion.value); } catch { /* Still ignore for this session. */ }
    const previous = update.value;
    update.value = null;
    state.value = "idle";
    error.value = "";
    dialogOpen.value = false;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    retryCount = 0;
    await release(previous);
    trackEvent("update", "ignore");
  }

  function start() {
    if (started || disposed || !desktop || import.meta.env.DEV) return;
    started = true;
    startupTimer = setTimeout(() => void checkForUpdates(true), 3_000);
    interval = setInterval(() => {
      if (retryTimer) return;
      retryCount = 0;
      void checkForUpdates(true);
    }, 3_600_000);
  }

  function dispose() {
    disposed = true;
    clearTimeout(startupTimer);
    clearTimeout(retryTimer);
    clearInterval(interval);
    void release(update.value);
    update.value = null;
  }
  onScopeDispose(dispose);

  return {
    desktop, state, update, error, progress, dialogOpen, hasUpdate, busy, isInstalling,
    installationBlockReason, checkForUpdates, downloadUpdate, installUpdate,
    ignoreVersion, setDialogOpen, start,
  };
}
