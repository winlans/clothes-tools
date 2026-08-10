<script setup lang="ts">
import { computed } from "vue";

import type { DocumentSession } from "../stores/document-session";
import { provideDocumentSession } from "../stores/document-session";
import LayoutEditor from "./LayoutEditor.vue";
import PageSidebar from "./PageSidebar.vue";

const props = defineProps<{ session: DocumentSession }>();
const emit = defineEmits<{ retry: [] }>();
provideDocumentSession(props.session);

const { documentStore } = props.session;
const progressPercent = computed(() => {
  if (documentStore.progress.total === 0) return 0;
  return Math.round(
    (documentStore.progress.completed / documentStore.progress.total) * 100,
  );
});
const exportPercent = computed(() =>
  Math.round(
    (documentStore.exportProgress.completed /
      Math.max(1, documentStore.exportProgress.total)) *
      100,
  ),
);

function startSpacerDrag(event: DragEvent) {
  event.dataTransfer?.setData("application/x-pdf2plt-spacer", "new");
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}
</script>

<template>
  <section v-if="props.session.ui.loadStatus === 'queued'" class="empty-state session-waiting">
    <div class="empty-state__mark">PDF</div>
    <h2>等待解析</h2>
    <p>后台同时处理两个文件，当前标签会优先进入队列。</p>
  </section>

  <section
    v-else-if="props.session.ui.loadStatus === 'error' || documentStore.status === 'error'"
    class="error-state"
  >
    <strong>无法打开 PDF</strong>
    <p>{{ documentStore.errorMessage }}</p>
    <button type="button" class="primary-button" @click="emit('retry')">重试</button>
  </section>

  <section v-else class="document-view">
    <div v-if="documentStore.status === 'loading'" class="progress-row">
      <div class="progress-track">
        <span :style="{ width: progressPercent + '%' }" />
      </div>
      <span>
        正在生成初始预览 {{ documentStore.progress.completed }}/{{ documentStore.progress.total || '…' }}
      </span>
      <button type="button" class="compact-button" @click="documentStore.cancelPreview()">
        取消预览
      </button>
    </div>

    <div v-if="documentStore.exportStatus === 'running'" class="progress-row export-progress">
      <div class="progress-track">
        <span :style="{ width: exportPercent + '%' }" />
      </div>
      <span>
        正在导出矢量页面 {{ documentStore.exportProgress.completed }}/{{ documentStore.exportProgress.total }}
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
</template>
