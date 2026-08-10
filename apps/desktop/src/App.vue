<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import DocumentWorkspace from "./components/DocumentWorkspace.vue";
import { usePdfImport } from "./composables/use-pdf-import";
import { useResolvedSettings } from "./composables/use-resolved-settings";
import {
  defaultSvgName,
  normalizeSvgName,
  useSvgExport,
  validateSessionExport,
} from "./composables/use-svg-export";
import type { DocumentSession } from "./stores/document-session";
import { useWorkspaceStore } from "./stores/workspace";

const fileInput = ref<HTMLInputElement>();
const showLegalNotice = ref(false);
const openCommandMenu = ref<"more" | undefined>();
const closeRequest = ref<{ kind: "tab"; id: string } | { kind: "application" }>();
const exportDialogOpen = ref(false);
const batchExporting = ref(false);
const exportDialogError = ref("");
const exportRows = ref<Array<{
  sessionId: string;
  title: string;
  selected: boolean;
  fileName: string;
  validationError: string;
}>>([]);
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
const canExportAnySession = computed(() =>
  workspace.tabs.some((session) => !validateSessionExport(session)),
);
const selectedExportCount = computed(
  () => exportRows.value.filter((row) => row.selected && !row.validationError).length,
);
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
  openCommandMenu.value = undefined;
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
  openCommandMenu.value = undefined;
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
  openCommandMenu.value = undefined;
  const documentStore = activeDocument.value;
  if (!documentStore) return;
  if (documentStore.exportStatus === "running") {
    documentStore.cancelExport();
    return;
  }
  await svgExport.exportCurrentSvg();
}

function uniqueDefaultSvgNames(sessions: DocumentSession[]) {
  const used = new Set<string>();
  return sessions.map((session) => {
    const defaultName = defaultSvgName(session.source.fileName);
    const base = defaultName.replace(/\.svg$/i, "");
    let candidate = defaultName;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) {
      candidate = `${base}-${suffix}.svg`;
      suffix += 1;
    }
    used.add(candidate.toLocaleLowerCase());
    return candidate;
  });
}

function openBatchExportDialog() {
  const defaults = uniqueDefaultSvgNames(workspace.tabs);
  exportRows.value = workspace.tabs.map((session, index) => {
    const validationError = validateSessionExport(session);
    return {
      sessionId: session.id,
      title: session.source.fileName,
      selected: !validationError,
      fileName: defaults[index] ?? defaultSvgName(session.source.fileName),
      validationError,
    };
  });
  exportDialogError.value = "";
  exportDialogOpen.value = true;
}

async function handleExportCommand() {
  openCommandMenu.value = undefined;
  if (activeDocument.value?.exportStatus === "running") {
    activeDocument.value.cancelExport();
    return;
  }
  if (workspace.tabs.length > 1) {
    openBatchExportDialog();
    return;
  }
  await handleExportAction();
}

function closeExportDialog() {
  if (batchExporting.value) return;
  exportDialogOpen.value = false;
  exportDialogError.value = "";
}

function normalizeExportRow(row: (typeof exportRows.value)[number]) {
  row.fileName = normalizeSvgName(row.fileName, row.title);
}

function validateExportRows(): string {
  const selected = exportRows.value.filter((row) => row.selected && !row.validationError);
  if (selected.length === 0) return "请至少选择一个可导出的标签。";
  const names = selected.map((row) => normalizeSvgName(row.fileName, row.title));
  const uniqueNames = new Set(names.map((name) => name.toLocaleLowerCase()));
  if (uniqueNames.size !== names.length) return "导出文件名不能重复。";
  return "";
}

async function confirmBatchExport() {
  const validationError = validateExportRows();
  if (validationError) {
    exportDialogError.value = validationError;
    return;
  }
  const entries = exportRows.value.flatMap((row) => {
    if (!row.selected || row.validationError) return [];
    const session = workspace.tabs.find((tab) => tab.id === row.sessionId);
    if (!session) return [];
    row.fileName = normalizeSvgName(row.fileName, row.title);
    return [{ session, fileName: row.fileName }];
  });
  batchExporting.value = true;
  exportDialogError.value = "";
  try {
    const result = await svgExport.exportSelectedSvgs(entries);
    if (result.cancelled) return;
    if (result.errors.length > 0) {
      const exportedNames = new Set(
        result.exported.map((fileName) => fileName.toLocaleLowerCase()),
      );
      for (const row of exportRows.value) {
        if (
          row.selected &&
          exportedNames.has(normalizeSvgName(row.fileName, row.title).toLocaleLowerCase())
        ) {
          row.selected = false;
        }
      }
      exportDialogError.value = [
        result.exported.length > 0
          ? `已成功导出 ${result.exported.length} 个文件；请处理其余项目后重试。`
          : "",
        ...result.errors,
      ].filter(Boolean).join("\n");
      return;
    }
    exportDialogOpen.value = false;
    pdfImport.importNotice.value = `已导出 ${result.exported.length} 个 SVG：${result.exported.join("、")}`;
  } finally {
    batchExporting.value = false;
  }
}

function closeActiveTab() {
  if (activeSession.value) requestCloseTab(activeSession.value);
}

function toggleGrid() {
  const session = activeSession.value;
  if (!session) return;
  session.ui.showGrid = !session.ui.showGrid;
}

function selectPreviewMode(mode: "cropped" | "full") {
  const session = activeSession.value;
  if (!session) return;
  session.guideStore.setPreviewModeValidated(
    mode,
    mode === "full" || Boolean(resolvedSettings.resolved.value.value),
  );
  openCommandMenu.value = undefined;
}

function openAbout() {
  openCommandMenu.value = undefined;
  showLegalNotice.value = true;
}

function handleApplicationKeyDown(event: KeyboardEvent) {
  if (event.code === "Escape" && exportDialogOpen.value) {
    event.preventDefault();
    closeExportDialog();
    return;
  }
  if (exportDialogOpen.value) {
    if (
      (event.ctrlKey || event.metaKey) &&
      ["o", "w"].includes(event.key.toLocaleLowerCase())
    ) {
      event.preventDefault();
    }
    return;
  }
  if (event.code === "Escape" && openCommandMenu.value) {
    event.preventDefault();
    openCommandMenu.value = undefined;
    return;
  }
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === "o") {
    event.preventDefault();
    void choosePdf();
  } else if (event.key.toLowerCase() === "w" && activeSession.value) {
    event.preventDefault();
    closeActiveTab();
  }
}

function closeCommandMenus() {
  openCommandMenu.value = undefined;
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
  window.addEventListener("keydown", handleApplicationKeyDown);
  window.addEventListener("pointerdown", closeCommandMenus);
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
  window.removeEventListener("keydown", handleApplicationKeyDown);
  window.removeEventListener("pointerdown", closeCommandMenus);
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
    <header class="app-commandbar" @pointerdown.stop>
      <strong class="app-commandbar__brand">pdf2plt</strong>
      <span class="app-commandbar__separator" />
      <nav class="app-commandbar__commands" aria-label="应用命令">
        <button type="button" class="app-command" title="打开 PDF（Ctrl+O）" @click="choosePdf">
          <svg class="app-command__icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.25 4.25h4l1.2 1.5h6.3v7.5H2.25z" />
          </svg>
          打开 PDF
        </button>
        <button
          type="button"
          class="app-command"
          :disabled="
            batchExporting ||
            (activeDocument?.exportStatus !== 'running' &&
              (workspace.tabs.length > 1
                ? !canExportAnySession
                : !activeDocument?.info || !resolvedSettings.canExport.value))
          "
          :title="
            workspace.tabs.length > 1
              ? '选择标签并导出 SVG'
              : resolvedSettings.validationError.value || '导出 SVG'
          "
          @click="handleExportCommand"
        >
          <svg class="app-command__icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2.25v7.5m-3-3 3 3 3-3M2.5 12.75h11" />
          </svg>
          {{ activeDocument?.exportStatus === 'running' ? '取消导出' : '导出 SVG' }}
        </button>
        <button
          type="button"
          class="app-command"
          :disabled="!activeSession"
          title="关闭当前标签（Ctrl+W）"
          @click="closeActiveTab"
        >
          <svg class="app-command__icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
          关闭标签
        </button>
        <div class="app-command-menu">
          <button
            type="button"
            class="app-command"
            :class="{ active: openCommandMenu === 'more' }"
            aria-haspopup="menu"
            :aria-expanded="openCommandMenu === 'more'"
            @click="openCommandMenu = openCommandMenu === 'more' ? undefined : 'more'"
          >
            更多 <span aria-hidden="true">⌄</span>
          </button>
          <div v-if="openCommandMenu === 'more'" class="app-command-menu__panel" role="menu">
            <button
              type="button"
              class="app-command-menu__item"
              role="menuitemcheckbox"
              :aria-checked="activeSession?.ui.showGrid ?? false"
              :disabled="!activeSession"
              @click="toggleGrid"
            >
              <span class="app-command-menu__mark">{{ activeSession?.ui.showGrid ? '✓' : '' }}</span>
              显示栅格
            </button>
            <div class="app-command-menu__separator" />
            <button
              type="button"
              class="app-command-menu__item"
              :disabled="!activeSession || !resolvedSettings.resolved.value.value"
              @click="selectPreviewMode('cropped')"
            >
              <span class="app-command-menu__mark">{{ activeSession?.guideStore.previewMode === 'cropped' ? '●' : '' }}</span>
              成品裁切
            </button>
            <button
              type="button"
              class="app-command-menu__item"
              :disabled="!activeSession"
              @click="selectPreviewMode('full')"
            >
              <span class="app-command-menu__mark">{{ activeSession?.guideStore.previewMode === 'full' ? '●' : '' }}</span>
              完整页面
            </button>
            <div class="app-command-menu__separator" />
            <button type="button" class="app-command-menu__item" @click="openAbout">
              <span class="app-command-menu__mark">ⓘ</span>
              关于与许可证
            </button>
          </div>
        </div>
      </nav>
      <div v-if="activeDocument?.info" class="topbar__document">
        <strong :title="activeDocument.fileName">{{ activeDocument.fileName }}</strong>
        <span>
          {{ activeDocument.info.pageCount }} 页 ·
          {{ activeDocument.info.pageSizePt.width.toFixed(3) }} ×
          {{ activeDocument.info.pageSizePt.height.toFixed(3) }} pt
        </span>
      </div>
      <input
        ref="fileInput"
        class="visually-hidden"
        type="file"
        accept="application/pdf,.pdf"
        multiple
        @change="handleBrowserFiles"
      />
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

    <div
      v-if="exportDialogOpen"
      class="legal-backdrop"
      @click.self="closeExportDialog"
    >
      <section
        class="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
      >
        <header class="export-dialog__header">
          <div>
            <span class="eyebrow">批量导出</span>
            <h2 id="export-dialog-title">选择要导出的标签</h2>
          </div>
          <button
            type="button"
            class="export-dialog__close"
            aria-label="关闭批量导出"
            :disabled="batchExporting"
            @click="closeExportDialog"
          >×</button>
        </header>
        <p class="export-dialog__description">
          默认选择所有可导出的标签。你可以取消选择或修改文件名，确认后再选择输出目录。
        </p>

        <div class="export-tab-list">
          <div
            v-for="row in exportRows"
            :key="row.sessionId"
            class="export-tab-row"
            :class="{ 'export-tab-row--disabled': row.validationError }"
          >
            <input
              v-model="row.selected"
              class="export-tab-row__checkbox"
              type="checkbox"
              :aria-label="`导出 ${row.title}`"
              :disabled="Boolean(row.validationError) || batchExporting"
              @change="exportDialogError = ''"
            />
            <div class="export-tab-row__meta">
              <strong :title="row.title">{{ row.title }}</strong>
              <small v-if="row.validationError">{{ row.validationError }}</small>
              <small v-else>可导出</small>
            </div>
            <label class="export-tab-row__filename">
              <span>文件名</span>
              <input
                v-model="row.fileName"
                type="text"
                spellcheck="false"
                :disabled="!row.selected || Boolean(row.validationError) || batchExporting"
                @input="exportDialogError = ''"
                @blur="normalizeExportRow(row)"
              />
            </label>
          </div>
        </div>

        <p v-if="exportDialogError" class="inline-error export-dialog__error" role="alert">
          {{ exportDialogError }}
        </p>
        <div class="dialog-actions">
          <button
            type="button"
            class="ghost-button"
            :disabled="batchExporting"
            @click="closeExportDialog"
          >取消</button>
          <button
            type="button"
            class="primary-button"
            :disabled="selectedExportCount === 0 || batchExporting"
            @click="confirmBatchExport"
          >
            {{ batchExporting ? '正在导出…' : `选择目录并导出（${selectedExportCount}）` }}
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
