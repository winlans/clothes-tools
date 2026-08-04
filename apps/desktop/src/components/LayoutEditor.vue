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

    <div class="layout-commandbar" aria-label="布局编辑命令">
      <button
        type="button"
        class="compact-button"
        :disabled="!layoutStore.canUndo"
        @click="layoutStore.undo()"
      >
        撤销
      </button>
      <button
        type="button"
        class="compact-button"
        :disabled="!layoutStore.canRedo"
        @click="layoutStore.redo()"
      >
        重做
      </button>
      <span class="command-separator" />
      <button
        type="button"
        class="compact-button"
        aria-label="增加一行"
        @click="layoutStore.addRow()"
      >
        + 行
      </button>
      <button
        type="button"
        class="compact-button"
        aria-label="删除最后一行"
        @click="layoutStore.removeLastRow()"
      >
        − 行
      </button>
      <button
        type="button"
        class="compact-button"
        aria-label="增加一列"
        @click="layoutStore.addColumn()"
      >
        + 列
      </button>
      <button
        type="button"
        class="compact-button"
        aria-label="删除最后一列"
        @click="layoutStore.removeLastColumn()"
      >
        − 列
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
      @insert-spacer="layoutStore.insertSpacer"
      @move-spacer="layoutStore.moveSpacerTo"
      @delete-spacer="layoutStore.deleteSpacer"
    />

    <footer class="canvas-status">
      <span>缩放 {{ Math.round(zoom * 100) }}%</span>
      <span>拖动成员吸附重排 · 双击删除空白 · 滚轮缩放 · 空格键平移</span>
    </footer>
  </section>
</template>
