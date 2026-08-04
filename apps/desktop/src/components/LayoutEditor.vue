<script setup lang="ts">
import {
  GUIDE_DIRECTIONS,
  type GuideDirection,
  type PageSizePt,
} from "@pdf2plt/core";
import { computed, reactive, ref, watch } from "vue";

import type { PreviewState } from "../stores/pdf-document";
import { useLayoutStore } from "../stores/layout";
import { useGuideStore } from "../stores/guides";
import { useProjectStore } from "../stores/project";
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
const guideDrafts = reactive<Record<GuideDirection, string>>({
  left: "",
  right: "",
  top: "",
  bottom: "",
});
const guideLabels: Record<GuideDirection, string> = {
  left: "左",
  right: "右",
  top: "上",
  bottom: "下",
};

const layoutSummary = computed(() => {
  const layout = layoutStore.layout;
  return layout ? `${layout.columns} 列 × ${layout.rows} 行` : "尚未排版";
});
const activeGuides = computed(() =>
  guideStore.previewMode === "cropped" ? guideStore.coordinates : undefined,
);
const missingGuideText = computed(() =>
  guideStore.missing.map((direction) => guideLabels[direction]).join("、"),
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

function applyManualGuide(direction: GuideDirection) {
  if (guideStore.setManual(direction, Number(guideDrafts[direction]), props.pageSize)) {
    const line = guideStore.lines[direction];
    if (line) guideDrafts[direction] = line.coordinatePt.toFixed(3);
  }
}

watch(
  () => layoutStore.pagesPerColumn,
  (value) => {
    draftPagesPerColumn.value = String(value);
  },
);

watch(
  () => guideStore.lines,
  (lines) => {
    for (const direction of GUIDE_DIRECTIONS) {
      const line = lines[direction];
      guideDrafts[direction] = line ? line.coordinatePt.toFixed(3) : "";
    }
  },
  { deep: true, immediate: true },
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

    <section class="guide-panel" aria-label="拼接线与裁切预览">
      <div class="guide-panel__heading">
        <div>
          <span class="eyebrow">拼接线</span>
          <strong>红线检测与裁切预览</strong>
        </div>
        <div class="mode-switch" role="group" aria-label="预览模式">
          <button
            type="button"
            :class="{ active: guideStore.previewMode === 'full' }"
            @click="guideStore.setPreviewMode('full')"
          >
            完整页面
          </button>
          <button
            type="button"
            :class="{ active: guideStore.previewMode === 'cropped' }"
            :disabled="!guideStore.canPreviewCropped"
            @click="guideStore.setPreviewMode('cropped')"
          >
            裁切拼接
          </button>
        </div>
      </div>

      <p v-if="guideStore.missing.length" class="guide-warning" role="status">
        未检测到{{ missingGuideText }}方向红线；可在下方手动填写对应 point 坐标。
      </p>
      <div v-else class="guide-success" role="status">四条红线已检测，可切换裁切拼接预览。</div>

      <div class="guide-fields">
        <label v-for="direction in GUIDE_DIRECTIONS" :key="direction">
          <span>{{ guideLabels[direction] }}线</span>
          <input
            v-model="guideDrafts[direction]"
            type="number"
            min="0"
            step="0.001"
            :aria-label="`${guideLabels[direction]}拼接线 point 坐标`"
            @change="applyManualGuide(direction)"
            @keydown.enter="applyManualGuide(direction)"
          />
          <small :class="`source-${guideStore.lines[direction]?.source ?? 'missing'}`">
            {{
              guideStore.lines[direction]?.source === 'auto'
                ? `自动 · ${guideStore.lines[direction]?.supportPages} 页`
                : guideStore.lines[direction]?.source === 'manual'
                  ? '手动'
                  : '缺失'
            }}
          </small>
        </label>
      </div>
    </section>

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
        {{ guideStore.previewMode === 'cropped' ? '裁切拼接预览' : '完整页面预览' }} ·
        拖动成员吸附重排 · 双击删除空白 · 滚轮缩放 · 空格键平移
      </span>
    </footer>
  </section>
</template>
