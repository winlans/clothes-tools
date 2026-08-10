import { createPinia, getActivePinia, type Pinia } from "pinia";
import {
  effectScope,
  inject,
  provide,
  reactive,
  watch,
  type EffectScope,
  type InjectionKey,
} from "vue";

import { useGuideStore } from "./guides";
import { useLayoutStore } from "./layout";
import { usePdfDocumentStore } from "./pdf-document";
import { useProjectStore } from "./project";

export type SessionLoadStatus = "queued" | "loading" | "ready" | "error";

export interface PdfImportCandidate {
  fileName: string;
  sourceKey: string;
  sourcePath?: string;
  load(): Promise<Uint8Array<ArrayBuffer>>;
}

export interface DocumentSession {
  id: string;
  source: {
    fileName: string;
    sourceKey: string;
    sourcePath: string | undefined;
    candidate: PdfImportCandidate;
  };
  ui: {
    loadStatus: SessionLoadStatus;
    dirty: boolean;
    showGrid: boolean;
    disposed: boolean;
  };
  documentStore: ReturnType<typeof usePdfDocumentStore>;
  layoutStore: ReturnType<typeof useLayoutStore>;
  guideStore: ReturnType<typeof useGuideStore>;
  projectStore: ReturnType<typeof useProjectStore>;
  markDirty(): void;
  dispose(): void;
}

const documentSessionKey: InjectionKey<DocumentSession> = Symbol("pdf2plt-document-session");
const fallbackSessions = new WeakMap<Pinia, DocumentSession>();

export function createDocumentSession(
  id: string,
  candidate: PdfImportCandidate,
): DocumentSession {
  const pinia = createPinia();
  const documentStore = usePdfDocumentStore(pinia);
  const layoutStore = useLayoutStore(pinia);
  const guideStore = useGuideStore(pinia);
  const projectStore = useProjectStore(pinia);
  const scope: EffectScope = effectScope(true);
  const source = reactive({
    fileName: candidate.fileName,
    sourceKey: candidate.sourceKey,
    sourcePath: candidate.sourcePath,
    candidate,
  });
  const ui = reactive({
    loadStatus: "queued" as SessionLoadStatus,
    dirty: false,
    showGrid: false,
    disposed: false,
  });

  scope.run(() => {
    watchDocumentState(documentStore, layoutStore, guideStore);
  });

  return {
    id,
    source,
    ui,
    documentStore,
    layoutStore,
    guideStore,
    projectStore,
    markDirty() {
      ui.dirty = true;
    },
    dispose() {
      if (ui.disposed) return;
      ui.disposed = true;
      scope.stop();
      documentStore.dispose();
      layoutStore.clear();
      guideStore.clear();
      documentStore.$dispose();
      layoutStore.$dispose();
      guideStore.$dispose();
      projectStore.$dispose();
    },
  };
}

function watchDocumentState(
  documentStore: ReturnType<typeof usePdfDocumentStore>,
  layoutStore: ReturnType<typeof useLayoutStore>,
  guideStore: ReturnType<typeof useGuideStore>,
) {
  watch(
    () => documentStore.info,
    (info) => {
      if (info) {
        layoutStore.initialize(info.documentId, info.pageCount);
        guideStore.initialize(info.documentId);
      } else {
        layoutStore.clear();
        guideStore.clear();
      }
    },
    { immediate: true },
  );
  watch(
    () => [documentStore.info?.documentId, documentStore.guideDetection] as const,
    ([documentId, detection]) => {
      if (!documentId || !detection) return;
      guideStore.applyDetection(documentId, detection);
      if (detection.inferredLayout) {
        layoutStore.applyDetectedColumnLayout(detection.inferredLayout);
      } else if (detection.inferredPagesPerColumn !== undefined) {
        layoutStore.applyDetectedPagesPerColumn(detection.inferredPagesPerColumn);
      }
    },
  );
}

export function provideDocumentSession(session: DocumentSession) {
  provide(documentSessionKey, session);
}

export function useDocumentSession(): DocumentSession {
  const session = inject(documentSessionKey, undefined);
  if (session) return session;
  const pinia = getActivePinia();
  if (!pinia) throw new Error("当前组件不在 PDF 文档会话中。");
  const existing = fallbackSessions.get(pinia);
  if (existing) return existing;
  const ui = reactive({
    loadStatus: "ready" as SessionLoadStatus,
    dirty: false,
    showGrid: false,
    disposed: false,
  });
  const fallback: DocumentSession = {
    id: "legacy-document-session",
    source: {
      fileName: "",
      sourceKey: "legacy",
      sourcePath: undefined,
      candidate: {
        fileName: "",
        sourceKey: "legacy",
        load: () => Promise.reject(new Error("测试会话不支持重新导入。")),
      },
    },
    ui,
    documentStore: usePdfDocumentStore(pinia),
    layoutStore: useLayoutStore(pinia),
    guideStore: useGuideStore(pinia),
    projectStore: useProjectStore(pinia),
    markDirty() {
      ui.dirty = true;
    },
    dispose() {
      ui.disposed = true;
    },
  };
  fallbackSessions.set(pinia, fallback);
  return fallback;
}
