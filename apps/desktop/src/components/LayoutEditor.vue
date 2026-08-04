<script setup lang="ts">
import type { PageSizePt } from "@pdf2plt/core";
import { computed, ref, watch } from "vue";

import { useResolvedSettings } from "../composables/use-resolved-settings";
import type { PreviewState } from "../stores/pdf-document";
import { useLayoutStore } from "../stores/layout";
import { useGuideStore } from "../stores/guides";
import { useProjectStore } from "../stores/project";
import AdvancedInspector from "./AdvancedInspector.vue";
import LayoutCanvas from "./LayoutCanvas.vue";

const props = defineProps<{
  pageSize: PageSizePt;
  previews: PreviewState[];
}>();

const layoutStore = useLayoutStore();
const guideStore = useGuideStore();
const projectStore = useProjectStore();
const canvas = ref<InstanceType<typeof LayoutCanvas>>();
const draftPagesPerColumn = ref(String(layoutStore.pagesPerColumn));
const zoom = ref(1);
const resolvedSettings = useResolvedSettings(() => props.pageSize);

const layoutSummary = computed(() => {
  const layout = layoutStore.layout;
  return layout ? `${layout.columns} 列 × ${layout.rows} 行` : "尚未排版";
});
const activeGuides = computed(() =>
  guideStore.previewMode === "cropped"
    ? resolvedSettings.resolved.value.value?.coordinates
    : undefined,
);
const initialCamera = computed(() =>
  projectStore.view
    ? {
        scale: projectStore.view.zoom,
        x: projectStore.view.panX,
        y: projectStore.view.panY,
      }
    : undefined,
);

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
    <p v-if="guideStore.errorMessage" class="inline-error" role="alert">
      {{ guideStore.errorMessage }}
    </p>

    <div class="layout-editor__body">
      <div class="canvas-column">
        <div class="canvas-preview-switch">
          <span class="eyebrow">画板预览</span>
          <div class="mode-switch" role="group" aria-label="预览模式">
            <button
              type="button"
              :class="{ active: guideStore.previewMode === 'full' }"
              @click="guideStore.setPreviewModeValidated('full', true)"
            >
              完整页面
            </button>
            <button
              type="button"
              :class="{ active: guideStore.previewMode === 'cropped' }"
              :disabled="!resolvedSettings.resolved.value.value"
              @click="guideStore.setPreviewModeValidated('cropped', Boolean(resolvedSettings.resolved.value.value))"
            >
              成品裁切
            </button>
          </div>
        </div>

        <LayoutCanvas
          v-if="layoutStore.layout"
          ref="canvas"
          :layout="layoutStore.layout"
          :page-size="props.pageSize"
          :previews="props.previews"
          :guides="activeGuides"
          :initial-camera="initialCamera"
          @zoom-change="zoom = $event"
          @view-change="projectStore.setView"
          @move-page="layoutStore.movePageTo"
          @insert-spacer="layoutStore.insertSpacer"
          @move-spacer="layoutStore.moveSpacerTo"
          @delete-spacer="layoutStore.deleteSpacer"
        />

        <footer class="canvas-status">
          <span>缩放 {{ Math.round(zoom * 100) }}%</span>
          <span>
            {{ guideStore.previewMode === 'cropped' ? '成品裁切预览' : '完整页面预览' }} ·
            拖动成员吸附重排 · 双击删除空白 · 滚轮缩放 · 空格键平移
          </span>
        </footer>
      </div>

      <AdvancedInspector :page-size="props.pageSize" />
    </div>
  </section>
</template>
