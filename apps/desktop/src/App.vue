<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import LayoutEditor from "./components/LayoutEditor.vue";
import PageSidebar from "./components/PageSidebar.vue";
import { usePdfImport } from "./composables/use-pdf-import";
import { useSvgExport } from "./composables/use-svg-export";
import { useResolvedSettings } from "./composables/use-resolved-settings";
import { usePdfDocumentStore } from "./stores/pdf-document";
import { useLayoutStore } from "./stores/layout";
import { useGuideStore } from "./stores/guides";

const fileInput = ref<HTMLInputElement>();
const showLegalNotice = ref(false);
const documentStore = usePdfDocumentStore();
const layoutStore = useLayoutStore();
const guideStore = useGuideStore();
const pdfImport = usePdfImport();
const svgExport = useSvgExport();
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
    if (documentId && detection) {
      guideStore.applyDetection(documentId, detection);
      if (detection.inferredLayout) {
        layoutStore.applyDetectedColumnLayout(detection.inferredLayout);
      } else if (detection.inferredPagesPerColumn !== undefined) {
        layoutStore.applyDetectedPagesPerColumn(detection.inferredPagesPerColumn);
      }
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
      <div class="topbar__brand">
        <span class="eyebrow">服装版图工具</span>
        <h1>pdf2plt</h1>
      </div>
      <div v-if="documentStore.info" class="topbar__document">
        <strong :title="documentStore.fileName">{{ documentStore.fileName }}</strong>
        <span>
          {{ documentStore.info.pageCount }} 页 ·
          {{ documentStore.info.pageSizePt.width.toFixed(3) }} ×
          {{ documentStore.info.pageSizePt.height.toFixed(3) }} pt
        </span>
      </div>
      <div class="topbar__actions">
        <button type="button" class="ghost-button" @click="showLegalNotice = true">
          关于与许可证
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

    <div
      v-if="showLegalNotice"
      class="legal-backdrop"
      @click.self="showLegalNotice = false"
    >
      <section
        class="legal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-title"
      >
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
        <button type="button" class="primary-button" @click="showLegalNotice = false">
          关闭
        </button>
      </section>
    </div>

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
