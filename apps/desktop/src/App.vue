<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronDownIcon,
  DownloadIcon,
  FileDownIcon,
  FolderOpenIcon,
  Grid2X2Icon,
  InfoIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import DocumentWorkspace from "./components/DocumentWorkspace.vue";
import IconButton from "./components/IconButton.vue";
import UpdateDialog from "./components/UpdateDialog.vue";
import WindowTitlebar from "./components/WindowTitlebar.vue";
import { Alert, AlertDescription } from "./components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import { Separator } from "./components/ui/separator";
import { usePdfImport } from "./composables/use-pdf-import";
import { useAppUpdater } from "./composables/use-app-updater";
import { useResolvedSettings } from "./composables/use-resolved-settings";
import {
  defaultExportName,
  exportFormatLabel,
  normalizeExportName,
  useVectorExport,
  validateSessionExport,
  type VectorExportFormat,
} from "./composables/use-svg-export";
import type { DocumentSession } from "./stores/document-session";
import { useWorkspaceStore } from "./stores/workspace";

const fileInput = ref<HTMLInputElement>();
const showLegalNotice = ref(false);
const closeRequest = ref<{ kind: "tab"; id: string } | { kind: "application" }>();
const exportDialogOpen = ref(false);
const batchExporting = ref(false);
const exportDialogError = ref("");
const exportFormat = ref<VectorExportFormat>("svg");
const exportRows = ref<Array<{
  sessionId: string;
  title: string;
  selected: boolean;
  fileName: string;
  validationError: string;
}>>([]);
const workspace = useWorkspaceStore();
const pdfImport = usePdfImport({ canImport: () => !updater.isInstalling.value });
const updater = useAppUpdater({
  installationBlockReason: () => {
    if (batchExporting.value || workspace.tabs.some((tab) =>
      tab.ui.loadStatus === "queued" || tab.ui.loadStatus === "loading" ||
      tab.documentStore.exportStatus === "running" || tab.documentStore.detectionStatus === "running"
    )) return "请等待 PDF 导入、计算或导出完成后再安装更新。";
    if (workspace.hasDirtyTabs) return "仍有未保存的排版修改，请保存工程或关闭相应标签后再安装更新。";
    return "";
  },
});
const activeSession = computed(() => workspace.activeSession);
const resolvedSettings = useResolvedSettings(
  () => activeSession.value?.documentStore.info?.pageSizePt,
  () => activeSession.value,
);
const vectorExport = useVectorExport(() => activeSession.value);
let unlistenCloseRequested: (() => void) | undefined;
let disposed = false;

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
    ? "该标签正在导出矢量文件，关闭会取消导出并丢失当前调整。"
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

async function handleExportAction(format: VectorExportFormat) {
  const documentStore = activeDocument.value;
  if (!documentStore) return;
  if (documentStore.exportStatus === "running") {
    documentStore.cancelExport();
    return;
  }
  await vectorExport.exportCurrent(format);
}

function uniqueDefaultExportNames(
  sessions: DocumentSession[],
  format: VectorExportFormat,
) {
  const used = new Set<string>();
  return sessions.map((session) => {
    const defaultName = defaultExportName(session.source.fileName, format);
    const extension = format === "svg" ? "svg" : "plt";
    const base = defaultName.replace(new RegExp(`\\.${extension}$`, "i"), "");
    let candidate = defaultName;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) {
      candidate = `${base}-${suffix}.${extension}`;
      suffix += 1;
    }
    used.add(candidate.toLocaleLowerCase());
    return candidate;
  });
}

function openBatchExportDialog(format: VectorExportFormat) {
  exportFormat.value = format;
  const defaults = uniqueDefaultExportNames(workspace.tabs, format);
  exportRows.value = workspace.tabs.map((session, index) => {
    const validationError = validateSessionExport(session);
    return {
      sessionId: session.id,
      title: session.source.fileName,
      selected: !validationError,
      fileName: defaults[index] ?? defaultExportName(session.source.fileName, format),
      validationError,
    };
  });
  exportDialogError.value = "";
  exportDialogOpen.value = true;
}

async function handleExportCommand(format: VectorExportFormat) {
  if (activeDocument.value?.exportStatus === "running") {
    activeDocument.value.cancelExport();
    return;
  }
  if (workspace.tabs.length > 1) {
    openBatchExportDialog(format);
    return;
  }
  await handleExportAction(format);
}

function closeExportDialog() {
  if (batchExporting.value) return;
  exportDialogOpen.value = false;
  exportDialogError.value = "";
}

function normalizeExportRow(row: (typeof exportRows.value)[number]) {
  row.fileName = normalizeExportName(row.fileName, row.title, exportFormat.value);
}

function validateExportRows(): string {
  const selected = exportRows.value.filter((row) => row.selected && !row.validationError);
  if (selected.length === 0) return "请至少选择一个可导出的标签。";
  const names = selected.map((row) =>
    normalizeExportName(row.fileName, row.title, exportFormat.value),
  );
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
    row.fileName = normalizeExportName(row.fileName, row.title, exportFormat.value);
    return [{ session, fileName: row.fileName }];
  });
  batchExporting.value = true;
  exportDialogError.value = "";
  try {
    const result = await vectorExport.exportSelected(exportFormat.value, entries);
    if (result.cancelled) return;
    if (result.errors.length > 0) {
      const exportedNames = new Set(
        result.exported.map((fileName) => fileName.toLocaleLowerCase()),
      );
      for (const row of exportRows.value) {
        if (
          row.selected &&
          exportedNames.has(
            normalizeExportName(row.fileName, row.title, exportFormat.value)
              .toLocaleLowerCase(),
          )
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
    const warning = result.warnings.length > 0
      ? `；${result.warnings.join("；")}`
      : "";
    pdfImport.importNotice.value =
      `已导出 ${result.exported.length} 个 ${exportFormatLabel(exportFormat.value)}：${result.exported.join("、")}${warning}`;
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
}

function openAbout() {
  showLegalNotice.value = true;
}

function handleApplicationKeyDown(event: KeyboardEvent) {
  if (updater.dialogOpen.value) return;
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
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === "o") {
    event.preventDefault();
    void choosePdf();
  } else if (event.key.toLowerCase() === "w" && activeSession.value) {
    event.preventDefault();
    closeActiveTab();
  }
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

function scrollDocumentTabs(event: WheelEvent) {
  const tabs = event.currentTarget as HTMLElement | null;
  if (!tabs || tabs.scrollWidth <= tabs.clientWidth) return;
  const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX
    : event.deltaY;
  if (rawDelta === 0) return;
  const unit = event.deltaMode === 1
    ? 32
    : event.deltaMode === 2
      ? tabs.clientWidth
      : 1;
  const maximum = tabs.scrollWidth - tabs.clientWidth;
  const next = Math.max(0, Math.min(maximum, tabs.scrollLeft + rawDelta * unit));
  if (next === tabs.scrollLeft) return;
  tabs.scrollLeft = next;
  event.preventDefault();
}

onMounted(async () => {
  updater.start();
  void pdfImport.startNativeDragDrop().catch(() => {
    pdfImport.importNotice.value = "拖放暂不可用，请使用“打开 PDF”导入文件。";
  });
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("keydown", handleApplicationKeyDown);
  if (pdfImport.isDesktop) {
    const unlisten = await getCurrentWindow().onCloseRequested((event) => {
      if (updater.isInstalling.value) { event.preventDefault(); return; }
      if (!hasUnsafeTabs()) return;
      event.preventDefault();
      closeRequest.value = { kind: "application" };
    });
    if (disposed) unlisten();
    else unlistenCloseRequested = unlisten;
  }
});

onBeforeUnmount(() => {
  disposed = true;
  pdfImport.stopNativeDragDrop();
  unlistenCloseRequested?.();
  window.removeEventListener("beforeunload", handleBeforeUnload);
  window.removeEventListener("keydown", handleApplicationKeyDown);
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
    <div class="app-top-chrome">
      <WindowTitlebar :close-disabled="updater.isInstalling.value" />
      <header class="app-commandbar">
      <nav class="app-commandbar__commands" aria-label="应用命令">
        <Button variant="ghost" class="app-command" title="打开 PDF（Ctrl+O）" @click="choosePdf">
          <FolderOpenIcon data-icon="inline-start" />
          打开 PDF
        </Button>

        <Button
          v-if="activeDocument?.exportStatus === 'running'"
          variant="ghost"
          class="app-command"
          @click="activeDocument.cancelExport()"
        >
          <DownloadIcon data-icon="inline-start" />
          取消导出
        </Button>
        <DropdownMenu v-else>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              class="app-command"
              :disabled="
                batchExporting ||
                (workspace.tabs.length > 1
                  ? !canExportAnySession
                  : !activeDocument?.info || !resolvedSettings.canExport.value)
              "
              :title="
                workspace.tabs.length > 1
                  ? '选择标签并导出矢量文件'
                  : resolvedSettings.validationError.value || '导出矢量文件'
              "
            >
              <DownloadIcon data-icon="inline-start" />
              导出
              <ChevronDownIcon data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-52">
            <DropdownMenuLabel>矢量导出</DropdownMenuLabel>
            <DropdownMenuItem @select="handleExportCommand('svg')">
              <FileDownIcon />
              导出 SVG
            </DropdownMenuItem>
            <DropdownMenuItem @select="handleExportCommand('plt')">
              <FileDownIcon />
              导出 PLT（CorelDRAW）
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" class="app-command">
              <MoreHorizontalIcon data-icon="inline-start" />
              更多
              <ChevronDownIcon data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-52">
            <DropdownMenuCheckboxItem
              :model-value="activeSession?.ui.showGrid ?? false"
              :disabled="!activeSession"
              @select.prevent="toggleGrid"
            >
              <Grid2X2Icon />
              显示栅格
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              :disabled="!activeSession || !resolvedSettings.resolved.value.value"
              @select="selectPreviewMode('cropped')"
            >
              成品裁切
              <Badge v-if="activeSession?.guideStore.previewMode === 'cropped'" variant="secondary" class="ml-auto">当前</Badge>
            </DropdownMenuItem>
            <DropdownMenuItem
              :disabled="!activeSession"
              @select="selectPreviewMode('full')"
            >
              完整页面
              <Badge v-if="activeSession?.guideStore.previewMode === 'full'" variant="secondary" class="ml-auto">当前</Badge>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem v-if="updater.desktop" @select="updater.checkForUpdates(false)">
              <RefreshCwIcon />
              检查更新
              <Badge v-if="updater.hasUpdate.value" variant="secondary" class="ml-auto">新版本</Badge>
            </DropdownMenuItem>
            <DropdownMenuItem @select="openAbout">
              <InfoIcon />
              关于与许可证
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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

      <nav
        v-if="workspace.tabs.length"
        class="document-tabs"
        aria-label="打开的 PDF"
        @wheel="scrollDocumentTabs"
      >
        <div
          v-for="tab in workspace.tabs"
          :key="tab.id"
          class="document-tab"
          :class="{ active: tab.id === workspace.activeTabId }"
        >
          <Button
            variant="ghost"
            class="document-tab__trigger"
            :aria-label="`切换到 ${tab.source.fileName}`"
            @click="workspace.activate(tab.id)"
          >
            <span class="document-tab__title" :title="tab.source.fileName">
              {{ tab.source.fileName }}
            </span>
            <span v-if="tab.ui.dirty" class="document-tab__dirty" aria-label="已修改">●</span>
            <Badge v-if="tabStatus(tab)" variant="secondary" class="document-tab__status">{{ tabStatus(tab) }}</Badge>
          </Button>
          <IconButton
            variant="ghost"
            size="icon-xs"
            class="document-tab__close"
            :tooltip="'关闭 ' + tab.source.fileName"
            @click.stop="requestCloseTab(tab)"
          >
            <XIcon />
          </IconButton>
        </div>
        <IconButton variant="ghost" size="icon" class="document-tabs__add" tooltip="打开更多 PDF" @click="choosePdf">
          <PlusIcon />
        </IconButton>
      </nav>
    </div>

    <Alert v-if="pdfImport.importNotice.value" class="import-notice" role="status">
      <AlertDescription>{{ pdfImport.importNotice.value }}</AlertDescription>
      <IconButton variant="ghost" size="icon-sm" tooltip="关闭导入提示" @click="pdfImport.importNotice.value = ''">
        <XIcon />
      </IconButton>
    </Alert>

    <Dialog v-model:open="showLegalNotice">
      <DialogContent class="legal-dialog">
        <DialogHeader>
          <Badge variant="secondary" class="w-fit">pdf2plt 0.1.8</Badge>
          <DialogTitle>关于与许可证</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          pdf2plt 与内含的 MuPDF.js 按 GNU Affero General Public License
          v3.0 或更高版本发布。
        </DialogDescription>
        <DialogDescription>
          Copyright © 2004–2026 Artifex Software, Inc.；Copyright © 2026
          pdf2plt contributors。
        </DialogDescription>
        <DialogDescription>
          本软件不提供任何担保。你可以依照 AGPL-3.0-or-later 复制、修改和再发布。
          完整条款、第三方声明与对应源码说明随安装包提供在 LICENSE、
          THIRD_PARTY_NOTICES.md 和 SOURCE_OFFER.md 中。
        </DialogDescription>
        <DialogFooter>
          <Button @click="showLegalNotice = false">关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <UpdateDialog :updater="updater" />

    <AlertDialog :open="Boolean(closeRequest)">
      <AlertDialogContent class="close-dialog">
        <AlertDialogHeader>
          <Badge variant="secondary" class="w-fit">确认关闭</Badge>
          <AlertDialogTitle>{{ closeRequest?.kind === 'application' ? '退出 pdf2plt？' : '关闭标签？' }}</AlertDialogTitle>
          <AlertDialogDescription>{{ closeMessage }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="closeRequest = undefined">取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" @click="confirmClose">
            {{ closeRequest?.kind === 'application' ? '放弃并退出' : '放弃并关闭' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog
      :open="exportDialogOpen"
      @update:open="(open) => { if (!open) closeExportDialog() }"
    >
      <DialogContent
        class="export-dialog sm:max-w-3xl"
        :show-close-button="false"
        @escape-key-down="(event) => { if (batchExporting) event.preventDefault() }"
        @pointer-down-outside="(event) => { if (batchExporting) event.preventDefault() }"
      >
        <DialogHeader class="export-dialog__header">
          <div>
            <Badge variant="secondary" class="mb-2 w-fit">批量导出</Badge>
            <DialogTitle>
              选择要导出的标签 · {{ exportFormatLabel(exportFormat) }}
            </DialogTitle>
          </div>
          <IconButton
            variant="ghost"
            size="icon"
            class="export-dialog__close"
            tooltip="关闭批量导出"
            :disabled="batchExporting"
            @click="closeExportDialog"
          ><XIcon /></IconButton>
        </DialogHeader>
        <DialogDescription class="export-dialog__description">
          默认选择所有可导出的标签。你可以取消选择或修改文件名，确认后再选择
          {{ exportFormatLabel(exportFormat) }} 输出目录。
        </DialogDescription>

        <div class="export-tab-list">
          <div
            v-for="row in exportRows"
            :key="row.sessionId"
            class="export-tab-row"
            :class="{ 'export-tab-row--disabled': row.validationError }"
          >
            <Checkbox
              class="export-tab-row__checkbox"
              :model-value="row.selected"
              :aria-label="`导出 ${row.title}`"
              :disabled="Boolean(row.validationError) || batchExporting"
              @update:model-value="row.selected = Boolean($event); exportDialogError = ''"
            />
            <div class="export-tab-row__meta">
              <strong :title="row.title">{{ row.title }}</strong>
              <small v-if="row.validationError">{{ row.validationError }}</small>
              <small v-else>可导出</small>
            </div>
            <label class="export-tab-row__filename">
              <span>文件名</span>
              <Input
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

        <Alert v-if="exportDialogError" variant="destructive" class="export-dialog__error" role="alert">
          <AlertDescription class="whitespace-pre-line">{{ exportDialogError }}</AlertDescription>
        </Alert>
        <DialogFooter>
          <Button
            variant="outline"
            :disabled="batchExporting"
            @click="closeExportDialog"
          >取消</Button>
          <Button
            :disabled="selectedExportCount === 0 || batchExporting"
            @click="confirmBatchExport"
          >
            {{ batchExporting ? '正在导出…' : `选择目录并导出（${selectedExportCount}）` }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Button
      v-if="!activeSession"
      variant="outline"
      class="empty-state empty-state--import"
      aria-label="选择 PDF 文件导入"
      @click="choosePdf"
    >
      <span class="empty-state__mark">PDF</span>
      <span class="empty-state__title">导入分块版图</span>
      <span class="empty-state__description">
        可选择或一次拖入多个 PDF；页面只在本机解析，不会上传到网络。
      </span>
    </Button>

    <DocumentWorkspace
      v-else
      :key="activeSession.id"
      :session="activeSession"
      @retry="workspace.retry(activeSession.id)"
      @reload="workspace.retry(activeSession.id)"
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
