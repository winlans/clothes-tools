<script setup lang="ts">
import type { PageSizePt } from "@pdf2plt/core";
import { computed, ref, watch } from "vue";

import type { PreviewState } from "../stores/pdf-document";
import { useLayoutStore } from "../stores/layout";
import LayoutCanvas from "./LayoutCanvas.vue";

const props = defineProps<{
  pageSize: PageSizePt;
  previews: PreviewState[];
}>();

const layoutStore = useLayoutStore();
const canvas = ref<InstanceType<typeof LayoutCanvas>>();
const draftPagesPerColumn = ref(String(layoutStore.pagesPerColumn));
const zoom = ref(1);

const layoutSummary = computed(() => {
  const layout = layoutStore.layout;
  return layout ? `${layout.columns} 列 × ${layout.rows} 行` : "尚未排版";
});

function applyAutomaticLayout() {
  const value = Number(draftPagesPerColumn.value);
  if (layoutStore.setPagesPerColumn(value)) {
    draftPagesPerColumn.value = String(layoutStore.pagesPerColumn);
  }
}

watch(
  () => layoutStore.pagesPerColumn,
  (value) => {
    draftPagesPerColumn.value = String(value);
  },
);
</script>

<template>
  <section class="layout-editor">
    <div class="layout-toolbar">
      <label>
        <span>每列页数</span>
        <input
          v-model="draftPagesPerColumn"
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          aria-describedby="layout-input-error"
          @change="applyAutomaticLayout"
          @keydown.enter="applyAutomaticLayout"
        />
      </label>
      <button type="button" class="ghost-button" @click="applyAutomaticLayout">
        自动排列
      </button>
      <span class="layout-toolbar__summary">{{ layoutSummary }}</span>
      <button type="button" class="ghost-button" @click="canvas?.fitContent()">
        适合内容
      </button>
    </div>

    <p
      v-if="layoutStore.errorMessage"
      id="layout-input-error"
      class="inline-error"
      role="alert"
    >
      {{ layoutStore.errorMessage }}
    </p>

    <LayoutCanvas
      v-if="layoutStore.layout"
      ref="canvas"
      :layout="layoutStore.layout"
      :page-size="props.pageSize"
      :previews="props.previews"
      @zoom-change="zoom = $event"
      @move-page="layoutStore.movePageTo"
    />

    <footer class="canvas-status">
      <span>缩放 {{ Math.round(zoom * 100) }}%</span>
      <span>拖动页面吸附重排 · 滚轮缩放 · 空格键 + 左键或中键平移</span>
    </footer>
  </section>
</template>
