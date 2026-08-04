<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import { usePdfImport } from "./composables/use-pdf-import";
import { usePdfDocumentStore } from "./stores/pdf-document";

const fileInput = ref<HTMLInputElement>();
const documentStore = usePdfDocumentStore();
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

onBeforeUnmount(() => documentStore.dispose());
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

      <div class="preview-workspace">
        <aside class="page-index" aria-label="PDF 页码列表">
          <span class="eyebrow">页面</span>
          <a
            v-for="preview in documentStore.previewList"
            :key="preview.pageNumber"
            :href="`#page-${preview.pageNumber}`"
          >
            {{ preview.pageNumber }}
          </a>
        </aside>

        <div class="preview-grid" aria-label="PDF 页面预览">
          <article
            v-for="preview in documentStore.previewList"
            :id="`page-${preview.pageNumber}`"
            :key="preview.pageNumber"
            class="preview-card"
          >
            <div class="preview-card__image">
              <img :src="preview.url" :alt="`第 ${preview.pageNumber} 页`" />
            </div>
            <span>第 {{ preview.pageNumber }} 页</span>
          </article>
        </div>
      </div>
    </section>
  </main>
</template>
