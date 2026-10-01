import { onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";

export function useWindowControls() {
  const desktop = isTauri();
  const isMaximized = ref(false);
  const error = ref("");
  let disposed = false;
  let toggling = false;
  let unlistenResize: (() => void) | undefined;

  async function refresh() {
    if (!desktop) return;
    const maximized = await getCurrentWindow().isMaximized();
    if (!disposed) isMaximized.value = maximized;
  }

  async function perform(action: () => Promise<unknown>) {
    if (!desktop || disposed) return;
    try {
      error.value = "";
      await action();
    } catch {
      if (!disposed) error.value = "窗口操作失败，请重试。";
    }
  }

  async function minimize() {
    await perform(() => getCurrentWindow().minimize());
  }

  async function toggleMaximize() {
    if (toggling) return;
    toggling = true;
    try {
      await perform(async () => {
        await getCurrentWindow().toggleMaximize();
        await refresh();
      });
    } finally { toggling = false; }
  }

  async function close() {
    // close() fires onCloseRequested, preserving the application's save confirmation.
    await perform(() => getCurrentWindow().close());
  }

  async function startDragging() {
    await perform(() => getCurrentWindow().startDragging());
  }

  onMounted(async () => {
    if (!desktop) return;
    await perform(async () => {
      const unlisten = await getCurrentWindow().onResized(() => void perform(refresh));
      if (disposed) { unlisten(); return; }
      unlistenResize = unlisten;
      await refresh();
    });
  });

  onUnmounted(() => { disposed = true; unlistenResize?.(); });

  return { desktop, isMaximized, error, minimize, toggleMaximize, close, startDragging };
}
