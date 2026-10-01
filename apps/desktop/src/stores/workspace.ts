import { defineStore } from "pinia";
import { computed, shallowRef, watch } from "vue";
import { trackEvent } from "../lib/analytics";

import {
  createDocumentSession,
  type DocumentSession,
  type PdfImportCandidate,
} from "./document-session";

export interface BatchImportResult {
  opened: number;
  duplicates: number;
  skipped: number;
  failed: number;
}

const MAX_CONCURRENT_IMPORTS = 2;

function waitForInitialLoad(session: DocumentSession): Promise<void> {
  return new Promise((resolve, reject) => {
    let stop: () => void = () => undefined;
    stop = watch(
      () => [
        session.documentStore.status,
        session.documentStore.detectionStatus,
        session.ui.disposed,
      ] as const,
      ([status, detectionStatus, disposed]) => {
        if (disposed) {
          stop();
          reject(new Error("PDF 导入已取消。"));
          return;
        }
        if (status === "error") {
          stop();
          reject(new Error(session.documentStore.errorMessage || "PDF 解析失败。"));
          return;
        }
        if (status === "ready" && detectionStatus !== "running") {
          stop();
          resolve();
        }
      },
      { immediate: true },
    );
  });
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const tabs = shallowRef<DocumentSession[]>([]);
  const activeTabId = shallowRef<string>();
  const queue = shallowRef<string[]>([]);
  let runningImports = 0;
  let nextTabId = 1;

  const activeSession = computed(
    () => tabs.value.find((tab) => tab.id === activeTabId.value),
  );
  const hasDirtyTabs = computed(() => tabs.value.some((tab) => tab.ui.dirty));

  function findBySourceKey(sourceKey: string, excludedId?: string) {
    return tabs.value.find(
      (tab) => tab.id !== excludedId && tab.source.sourceKey === sourceKey,
    );
  }

  function activate(id: string) {
    const session = tabs.value.find((tab) => tab.id === id);
    if (!session) return;
    activeTabId.value = id;
    if (session.ui.loadStatus === "queued") {
      queue.value = [id, ...queue.value.filter((queuedId) => queuedId !== id)];
    }
    for (const tab of tabs.value) {
      tab.documentStore.setPreviewCacheLimit(tab.id === id ? 18 : 3);
    }
    pumpQueue();
  }

  function enqueueCandidates(candidates: PdfImportCandidate[]): BatchImportResult {
    const result: BatchImportResult = { opened: 0, duplicates: 0, skipped: 0, failed: 0 };
    let firstNewId: string | undefined;
    let firstDuplicateId: string | undefined;
    const batchKeys = new Set<string>();

    for (const candidate of candidates) {
      if (batchKeys.has(candidate.sourceKey)) {
        result.duplicates += 1;
        continue;
      }
      batchKeys.add(candidate.sourceKey);
      const duplicate = findBySourceKey(candidate.sourceKey);
      if (duplicate) {
        result.duplicates += 1;
        firstDuplicateId ??= duplicate.id;
        continue;
      }
      const session = createDocumentSession(`pdf-tab-${nextTabId++}`, candidate);
      tabs.value = [...tabs.value, session];
      queue.value = [...queue.value, session.id];
      firstNewId ??= session.id;
      result.opened += 1;
    }

    if (firstNewId) activate(firstNewId);
    else if (firstDuplicateId) activate(firstDuplicateId);
    pumpQueue();
    return result;
  }

  async function loadSession(session: DocumentSession) {
    session.ui.loadStatus = "loading";
    session.ui.dirty = false;
    session.documentStore.close();
    session.projectStore.startNewDocument();
    try {
      const bytes = await session.source.candidate.load();
      if (session.ui.disposed) return;
      await session.documentStore.open(
        bytes,
        session.source.fileName,
        session.source.sourcePath,
      );
      if (session.source.sourceKey.startsWith("browser:")) {
        const fingerprintKey = `sha256:${session.documentStore.sourceSha256}`;
        const duplicate = findBySourceKey(fingerprintKey, session.id);
        if (duplicate) {
          const wasActive = activeTabId.value === session.id;
          remove(session.id);
          if (wasActive) activate(duplicate.id);
          return;
        }
        session.source.sourceKey = fingerprintKey;
      }
      await waitForInitialLoad(session);
      if (!session.ui.disposed) {
        session.ui.loadStatus = "ready";
        trackEvent("pdf", "import_success", "pages", session.documentStore.info?.pageCount);
      }
    } catch (error) {
      if (session.ui.disposed) return;
      session.ui.loadStatus = "error";
      trackEvent("pdf", "import_failed");
      session.documentStore.status = "error";
      session.documentStore.errorMessage =
        error instanceof Error ? error.message : "PDF 导入失败。";
    }
  }

  function pumpQueue() {
    while (runningImports < MAX_CONCURRENT_IMPORTS && queue.value.length > 0) {
      const [id, ...remaining] = queue.value;
      queue.value = remaining;
      const session = tabs.value.find((tab) => tab.id === id);
      if (!session || session.ui.disposed || session.ui.loadStatus !== "queued") continue;
      runningImports += 1;
      void loadSession(session).finally(() => {
        runningImports -= 1;
        pumpQueue();
      });
    }
  }

  function retry(id: string) {
    const session = tabs.value.find((tab) => tab.id === id);
    if (!session || session.ui.disposed) return;
    session.ui.loadStatus = "queued";
    session.documentStore.errorMessage = "";
    queue.value = [id, ...queue.value.filter((queuedId) => queuedId !== id)];
    activate(id);
  }

  function remove(id: string) {
    const index = tabs.value.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const [session] = tabs.value.splice(index, 1);
    tabs.value = [...tabs.value];
    queue.value = queue.value.filter((queuedId) => queuedId !== id);
    session?.dispose();

    if (activeTabId.value !== id) return;
    const next = tabs.value[index] ?? tabs.value[index - 1];
    activeTabId.value = next?.id;
    if (next) activate(next.id);
  }

  function disposeAll() {
    for (const session of tabs.value) session.dispose();
    tabs.value = [];
    queue.value = [];
    activeTabId.value = undefined;
  }

  return {
    tabs,
    activeTabId,
    activeSession,
    hasDirtyTabs,
    activate,
    enqueueCandidates,
    retry,
    remove,
    disposeAll,
  };
});
