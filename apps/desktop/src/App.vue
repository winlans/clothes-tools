<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import LayoutEditor from "./components/LayoutEditor.vue";
import PageSidebar from "./components/PageSidebar.vue";
import { usePdfImport } from "./composables/use-pdf-import";
import { useSvgExport } from "./composables/use-svg-export";
import { useProjectFile } from "./composables/use-project-file";
import { useResolvedSettings } from "./composables/use-resolved-settings";
import { usePdfDocumentStore } from "./stores/pdf-document";
import { useLayoutStore } from "./stores/layout";
import { useGuideStore } from "./stores/guides";
import { useProjectStore } from "./stores/project";

const fileInput = ref<HTMLInputElement>();
const documentStore = usePdfDocumentStore();
const layoutStore = useLayoutStore();
const guideStore = useGuideStore();
const projectStore = useProjectStore();
const pdfImport = usePdfImport();
const svgExport = useSvgExport();
const projectFile = useProjectFile();
const resolvedSettings = useResolvedSettings(() => documentStore.info?.pageSizePt);

const progressPercent = computed(() => {
  if (documentStore.progress.total === 0) return 0;
  return Math.round(
    (documentStore.progress.completed / documentStore.progress.total) * 100,
  );
});

async function choosePdf() {
  if (pdfImport.isDesktop) {
    await pdfImport.openTauriPdf();
  } else {
    fileInput.value?.click();
  }
}

async function handleBrowserFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) await pdfImport.openBrowserPdf(file);
  target.value = "";
}

function startSpacerDrag(event: DragEvent) {
  event.dataTransfer?.setData("application/x-pdf2plt-spacer", "new");
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

function closeDocument() {
  documentStore.close();
  projectStore.startNewDocument();
}

async function handleExportAction() {
  if (documentStore.exportStatus === "running") {
    documentStore.cancelExport();
    return;
  }
  await svgExport.exportCurrentSvg();
}

watch(
  () => documentStore.info,
  (info) => {
    if (info) {
      const pending = projectStore.pendingProject;
      if (pending) {
        const samePageCount = info.pageCount === pending.source.pageCount;
        const samePageSize =
          Math.abs(info.pageSizePt.width - pending.source.pageSizePt.width) <= 0.02 &&
          Math.abs(info.pageSizePt.height - pending.source.pageSizePt.height) <= 0.02;
        const sameSha = documentStore.sourceSha256 === pending.source.sha256;
        if (!samePageCount || !samePageSize || !sameSha) {
          const mismatch = !sameSha
            ? "SHA-256"
            : !samePageCount
              ? "页数"
              : "页面尺寸";
          documentStore.close();
          projectStore.fail(`所选 PDF 的${mismatch}与工程记录不一致，未恢复布局。`);
          return;
        }
        layoutStore.restore(info.documentId, info.pageCount, pending.layout);
        guideStore.restore(info.documentId, pending.guides);
        projectStore.completeOpen(pending);
        return;
      }
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
    if (
      documentId &&
      detection &&
      !projectStore.pendingProject &&
      !projectStore.activeProject
    ) {
      guideStore.applyDetection(documentId, detection);
    }
  },
);

onBeforeUnmount(() => {
  documentStore.dispose();
  layoutStore.clear();
  guideStore.clear();
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div>
        <span class="eyebrow">服装版图工具</span>
        <h1>pdf2plt</h1>
      </div>
      <div class="topbar__actions">
        <button
          type="button"
          class="ghost-button"
          :disabled="projectStore.status === 'opening' || projectStore.status === 'saving'"
          @click="projectFile.openProject()"
        >
          {{ projectStore.status === 'opening' ? '正在打开…' : '打开工程' }}
        </button>
        <button
          v-if="documentStore.info"
          type="button"
          class="ghost-button"
          :disabled="projectStore.status === 'saving'"
          @click="projectFile.saveProject()"
        >
          {{ projectStore.status === 'saving' ? '正在保存…' : '保存工程' }}
        </button>
        <button
          v-if="documentStore.info"
          type="button"
          class="primary-button"
          :disabled="
            documentStore.exportStatus !== 'running' && !resolvedSettings.canExport.value
          "
          :title="resolvedSettings.validationError.value || '导出合并后的矢量 SVG'"
          @click="handleExportAction"
        >
          {{ documentStore.exportStatus === 'running' ? '取消导出' : '导出 SVG' }}
        </button>
        <button
          v-if="documentStore.info"
          type="button"
          class="ghost-button"
          @click="closeDocument"
        >
          关闭
        </button>
        <button type="button" class="primary-button" @click="choosePdf">
          {{ documentStore.info ? "更换 PDF" : "打开 PDF" }}
        </button>
        <input
          ref="fileInput"
          class="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          @change="handleBrowserFile"
        />
      </div>
    </header>

    <p v-if="projectStore.errorMessage" class="inline-error project-message" role="alert">
      {{ projectStore.errorMessage }}
    </p>
    <p v-else-if="projectStore.successMessage" class="export-summary project-message" role="status">
      {{ projectStore.successMessage }}
    </p>

    <section v-if="documentStore.status === 'idle'" class="empty-state">
      <div class="empty-state__mark">PDF</div>
      <h2>导入分块版图</h2>
      <p>页面预览会在本机解析，不会上传到网络。</p>
    </section>

    <section v-else-if="documentStore.status === 'error'" class="error-state">
      <strong>无法打开 PDF</strong>
      <p>{{ documentStore.errorMessage }}</p>
      <button type="button" class="primary-button" @click="choosePdf">重新选择</button>
    </section>

    <section v-else class="document-view">
      <div class="document-summary">
        <div>
          <span class="eyebrow">当前文档</span>
          <h2>{{ documentStore.fileName }}</h2>
        </div>
        <dl v-if="documentStore.info">
          <div>
            <dt>页数</dt>
            <dd>{{ documentStore.info.pageCount }}</dd>
          </div>
          <div>
            <dt>单页尺寸</dt>
            <dd>
              {{ documentStore.info.pageSizePt.width.toFixed(3) }} ×
              {{ documentStore.info.pageSizePt.height.toFixed(3) }} pt
            </dd>
          </div>
        </dl>
      </div>

      <div v-if="documentStore.status === 'loading'" class="progress-row">
        <div class="progress-track">
          <span :style="{ width: `${progressPercent}%` }" />
        </div>
        <span>
          正在生成预览 {{ documentStore.progress.completed }}/{{ documentStore.progress.total || '…' }}
        </span>
        <button type="button" class="compact-button" @click="documentStore.cancelPreview()">
          取消预览
        </button>
      </div>

      <div v-if="documentStore.exportStatus === 'running'" class="progress-row export-progress">
        <div class="progress-track">
          <span
            :style="{
              width: `${Math.round(
                (documentStore.exportProgress.completed /
                  Math.max(1, documentStore.exportProgress.total)) *
                  100,
              )}%`,
            }"
          />
        </div>
        <span>
          正在导出矢量页面 {{ documentStore.exportProgress.completed }}/{{
            documentStore.exportProgress.total
          }}
        </span>
      </div>
      <p v-if="documentStore.exportErrorMessage" class="inline-error" role="alert">
        {{ documentStore.exportErrorMessage }}
      </p>
      <p v-if="documentStore.exportStatus === 'cancelled'" class="guide-warning" role="status">
        SVG 导出已取消，未写入输出文件。
      </p>
      <p
        v-if="documentStore.exportStatus === 'complete' && documentStore.exportSummary"
        class="export-summary"
        role="status"
      >
        SVG 已生成：{{ documentStore.exportSummary.pageInstances }} 个页面实例，
        {{ ((documentStore.exportSummary.widthPt * 25.4) / 72).toFixed(2) }} ×
        {{ ((documentStore.exportSummary.heightPt * 25.4) / 72).toFixed(2) }} mm，
        {{ documentStore.exportSummary.visibleObjects }} 个矢量/图像对象。
      </p>

      <div v-if="documentStore.info" class="editor-workspace">
        <PageSidebar
          :pages="documentStore.info.pages"
          :previews="documentStore.previews"
          @spacer-drag-start="startSpacerDrag"
          @visible-pages="documentStore.prioritizePreviews"
        />

        <LayoutEditor
          :page-size="documentStore.info.pageSizePt"
          :previews="documentStore.previewList"
        />
      </div>
    </section>
  </main>
</template>
