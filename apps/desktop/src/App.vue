<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import LayoutEditor from "./components/LayoutEditor.vue";
import { usePdfImport } from "./composables/use-pdf-import";
import { usePdfDocumentStore } from "./stores/pdf-document";
import { useLayoutStore } from "./stores/layout";

const fileInput = ref<HTMLInputElement>();
const documentStore = usePdfDocumentStore();
const layoutStore = useLayoutStore();
const pdfImport = usePdfImport();

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

watch(
  () => documentStore.info,
  (info) => {
    if (info) {
      layoutStore.initialize(info.documentId, info.pageCount);
    } else {
      layoutStore.clear();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  documentStore.dispose();
  layoutStore.clear();
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
          v-if="documentStore.info"
          type="button"
          class="ghost-button"
          @click="documentStore.close()"
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
      </div>

      <div v-if="documentStore.info" class="editor-workspace">
        <aside class="page-sidebar" aria-label="PDF 页码列表">
          <span class="eyebrow">页面</span>
          <button
            type="button"
            class="spacer-tool"
            draggable="true"
            title="拖到画板格子中插入空白占位"
            @dragstart="startSpacerDrag"
          >
            <span class="spacer-tool__mark">＋</span>
            拖入空白块
          </button>
          <article
            v-for="page in documentStore.info.pages"
            :key="page.pageNumber"
            class="page-thumbnail"
          >
            <div class="page-thumbnail__image">
              <img
                v-if="documentStore.previews[page.pageNumber]"
                :src="documentStore.previews[page.pageNumber]?.url"
                :alt="`第 ${page.pageNumber} 页缩略图`"
              />
              <span v-else>…</span>
            </div>
            <span>第 {{ page.pageNumber }} 页</span>
          </article>
        </aside>

        <LayoutEditor
          :page-size="documentStore.info.pageSizePt"
          :previews="documentStore.previewList"
        />
      </div>
    </section>
  </main>
</template>
