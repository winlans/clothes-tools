<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import DocumentWorkspace from "./components/DocumentWorkspace.vue";
import { usePdfImport } from "./composables/use-pdf-import";
import { useResolvedSettings } from "./composables/use-resolved-settings";
import { useSvgExport } from "./composables/use-svg-export";
import type { DocumentSession } from "./stores/document-session";
import { useWorkspaceStore } from "./stores/workspace";

const fileInput = ref<HTMLInputElement>();
const showLegalNotice = ref(false);
const closeRequest = ref<{ kind: "tab"; id: string } | { kind: "application" }>();
const workspace = useWorkspaceStore();
const pdfImport = usePdfImport();
const activeSession = computed(() => workspace.activeSession);
const resolvedSettings = useResolvedSettings(
  () => activeSession.value?.documentStore.info?.pageSizePt,
  () => activeSession.value,
);
const svgExport = useSvgExport(() => activeSession.value);
let unlistenCloseRequested: (() => void) | undefined;

const activeDocument = computed(() => activeSession.value?.documentStore);
const closeMessage = computed(() => {
  if (closeRequest.value?.kind === "application") {
    const count = workspace.tabs.filter(
      (tab) => tab.ui.dirty || tab.documentStore.exportStatus === "running",
    ).length;
    return `仍有 ${count} 个标签包含未保存修改或正在导出，退出后这些状态将丢失。`;
  }
  const request = closeRequest.value;
  const session = request?.kind === "tab"
    ? workspace.tabs.find((tab) => tab.id === request.id)
    : undefined;
  return session?.documentStore.exportStatus === "running"
    ? "该标签正在导出 SVG，关闭会取消导出并丢失当前调整。"
    : "该标签包含尚未保存的排版或导出设置，关闭后无法恢复。";
});

function hasUnsafeTabs() {
  return workspace.tabs.some(
    (tab) => tab.ui.dirty || tab.documentStore.exportStatus === "running",
  );
}

async function choosePdf() {
  if (pdfImport.isDesktop) {
    await pdfImport.choosePdfs();
  } else {
    fileInput.value?.click();
  }
}

async function handleBrowserFiles(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.files) await pdfImport.openBrowserPdfs([...target.files]);
  target.value = "";
}

function requestCloseTab(session: DocumentSession) {
  if (session.ui.dirty || session.documentStore.exportStatus === "running") {
    closeRequest.value = { kind: "tab", id: session.id };
    return;
  }
  workspace.remove(session.id);
}

async function confirmClose() {
  const request = closeRequest.value;
  closeRequest.value = undefined;
  if (!request) return;
  if (request.kind === "tab") {
    workspace.remove(request.id);
    return;
  }
  workspace.disposeAll();
  if (pdfImport.isDesktop) await getCurrentWindow().destroy();
}

async function handleExportAction() {
  const documentStore = activeDocument.value;
  if (!documentStore) return;
  if (documentStore.exportStatus === "running") {
    documentStore.cancelExport();
    return;
  }
  await svgExport.exportCurrentSvg();
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsafeTabs()) return;
  event.preventDefault();
}

function tabStatus(session: DocumentSession) {
  if (session.ui.loadStatus === "queued") return "排队";
  if (session.ui.loadStatus === "loading") return "加载";
  if (session.ui.loadStatus === "error") return "错误";
  if (session.documentStore.exportStatus === "running") return "导出";
  return "";
}

onMounted(async () => {
  await pdfImport.startNativeDragDrop();
  window.addEventListener("beforeunload", handleBeforeUnload);
  if (pdfImport.isDesktop) {
    unlistenCloseRequested = await getCurrentWindow().onCloseRequested((event) => {
      if (!hasUnsafeTabs()) return;
      event.preventDefault();
      closeRequest.value = { kind: "application" };
    });
  }
});

onBeforeUnmount(() => {
  pdfImport.stopNativeDragDrop();
  unlistenCloseRequested?.();
  window.removeEventListener("beforeunload", handleBeforeUnload);
  workspace.disposeAll();
});
</script>

<template>
  <main
    class="app-shell"
    @dragover="pdfImport.handleBrowserDragOver"
    @dragleave="pdfImport.handleBrowserDragLeave"
    @drop="pdfImport.handleBrowserDrop"
  >
    <header class="topbar">
      <div class="topbar__brand">
        <span class="eyebrow">服装版图工具</span>
        <h1>pdf2plt</h1>
      </div>
      <div v-if="activeDocument?.info" class="topbar__document">
        <strong :title="activeDocument.fileName">{{ activeDocument.fileName }}</strong>
        <span>
          {{ activeDocument.info.pageCount }} 页 ·
          {{ activeDocument.info.pageSizePt.width.toFixed(3) }} ×
          {{ activeDocument.info.pageSizePt.height.toFixed(3) }} pt
        </span>
      </div>
      <div class="topbar__actions">
        <button type="button" class="ghost-button" @click="showLegalNotice = true">
          关于与许可证
        </button>
        <button
          v-if="activeDocument?.info"
          type="button"
          class="primary-button"
          :disabled="
            activeDocument.exportStatus !== 'running' && !resolvedSettings.canExport.value
          "
          :title="resolvedSettings.validationError.value || '导出合并后的矢量 SVG'"
          @click="handleExportAction"
        >
          {{ activeDocument.exportStatus === 'running' ? '取消导出' : '导出 SVG' }}
        </button>
        <button
          v-if="activeSession"
          type="button"
          class="ghost-button"
          @click="requestCloseTab(activeSession)"
        >
          关闭
        </button>
        <button type="button" class="primary-button" @click="choosePdf">
          打开 PDF
        </button>
        <input
          ref="fileInput"
          class="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          @change="handleBrowserFiles"
        />
      </div>
    </header>

    <nav v-if="workspace.tabs.length" class="document-tabs" aria-label="打开的 PDF">
      <button
        v-for="tab in workspace.tabs"
        :key="tab.id"
        type="button"
        class="document-tab"
        :class="{ active: tab.id === workspace.activeTabId }"
        :title="tab.source.fileName"
        @click="workspace.activate(tab.id)"
      >
        <span class="document-tab__title">{{ tab.source.fileName }}</span>
        <span v-if="tab.ui.dirty" class="document-tab__dirty" aria-label="已修改">●</span>
        <span v-if="tabStatus(tab)" class="document-tab__status">{{ tabStatus(tab) }}</span>
        <span
          class="document-tab__close"
          role="button"
          :aria-label="'关闭 ' + tab.source.fileName"
          @click.stop="requestCloseTab(tab)"
        >×</span>
      </button>
      <button type="button" class="document-tabs__add" aria-label="打开更多 PDF" @click="choosePdf">
        ＋
      </button>
    </nav>

    <p v-if="pdfImport.importNotice.value" class="import-notice" role="status">
      {{ pdfImport.importNotice.value }}
      <button type="button" aria-label="关闭导入提示" @click="pdfImport.importNotice.value = ''">×</button>
    </p>

    <div
      v-if="showLegalNotice"
      class="legal-backdrop"
      @click.self="showLegalNotice = false"
    >
      <section class="legal-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-title">
        <span class="eyebrow">pdf2plt 0.1.0</span>
        <h2 id="legal-title">关于与许可证</h2>
        <p>
          pdf2plt 与内含的 MuPDF.js 按 GNU Affero General Public License
          v3.0 或更高版本发布。
        </p>
        <p>
          Copyright © 2004–2026 Artifex Software, Inc.；Copyright © 2026
          pdf2plt contributors。
        </p>
        <p>
          本软件不提供任何担保。你可以依照 AGPL-3.0-or-later 复制、修改和再发布。
          完整条款、第三方声明与对应源码说明随安装包提供在 LICENSE、
          THIRD_PARTY_NOTICES.md 和 SOURCE_OFFER.md 中。
        </p>
        <button type="button" class="primary-button" @click="showLegalNotice = false">关闭</button>
      </section>
    </div>

    <div v-if="closeRequest" class="legal-backdrop" @click.self="closeRequest = undefined">
      <section class="legal-dialog close-dialog" role="alertdialog" aria-modal="true">
        <span class="eyebrow">确认关闭</span>
        <h2>{{ closeRequest.kind === 'application' ? '退出 pdf2plt？' : '关闭标签？' }}</h2>
        <p>{{ closeMessage }}</p>
        <div class="dialog-actions">
          <button type="button" class="ghost-button" @click="closeRequest = undefined">取消</button>
          <button type="button" class="danger-button" @click="confirmClose">
            {{ closeRequest.kind === 'application' ? '放弃并退出' : '放弃并关闭' }}
          </button>
        </div>
      </section>
    </div>

    <section v-if="!activeSession" class="empty-state">
      <div class="empty-state__mark">PDF</div>
      <h2>导入分块版图</h2>
      <p>可选择或一次拖入多个 PDF；页面只在本机解析，不会上传到网络。</p>
    </section>

    <DocumentWorkspace
      v-else
      :key="activeSession.id"
      :session="activeSession"
      @retry="workspace.retry(activeSession.id)"
    />

    <div v-if="pdfImport.dropActive.value" class="file-drop-overlay" role="status">
      <div>
        <strong>释放以打开 PDF</strong>
        <span v-if="pdfImport.dropCount.value">
          检测到 {{ pdfImport.dropCount.value }} 个文件
        </span>
        <span v-else>非 PDF 文件会自动跳过</span>
      </div>
    </div>
  </main>
</template>
