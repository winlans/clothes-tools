// @vitest-environment jsdom
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  destroy: vi.fn(() => Promise.resolve()),
  closeHandler: undefined as ((event: { preventDefault(): void }) => void) | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy: tauriMocks.destroy,
    onCloseRequested: async (
      handler: (event: { preventDefault(): void }) => void,
    ) => {
      tauriMocks.closeHandler = handler;
      return () => undefined;
    },
  }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async () => () => undefined,
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import App from "./App.vue";
import { createDocumentSession } from "./stores/document-session";
import { useWorkspaceStore } from "./stores/workspace";

describe("application close confirmation", () => {
  beforeEach(() => {
    tauriMocks.destroy.mockClear();
    tauriMocks.closeHandler = undefined;
    document.body.innerHTML = "";
  });

  it("destroys the desktop window after discarding unsafe tabs", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore(pinia);
    const session = createDocumentSession("dirty-tab", {
      fileName: "dirty.pdf",
      sourceKey: "path:/tmp/dirty.pdf",
      sourcePath: "/tmp/dirty.pdf",
      load: () => Promise.reject(new Error("not used")),
    });
    session.ui.loadStatus = "error";
    session.ui.dirty = true;
    workspace.tabs = [session];
    workspace.activate(session.id);

    const wrapper = mount(App, {
      attachTo: document.body,
      global: { plugins: [pinia] },
    });
    await flushPromises();

    const preventDefault = vi.fn();
    tauriMocks.closeHandler?.({ preventDefault });
    await nextTick();

    expect(preventDefault).toHaveBeenCalledOnce();
    const body = new DOMWrapper(document.body);
    const discard = body.findAll("button").find((button) =>
      button.text().includes("放弃并退出")
    );
    expect(discard?.exists()).toBe(true);
    await discard?.trigger("click");
    await flushPromises();

    expect(workspace.tabs).toHaveLength(0);
    expect(tauriMocks.destroy).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
