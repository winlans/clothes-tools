<script setup lang="ts">
import type { PageSizePt } from "@pdf2plt/core";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useResolvedSettings } from "../composables/use-resolved-settings";
import type { PreviewState } from "../stores/pdf-document";
import { useLayoutStore } from "../stores/layout";
import { useGuideStore } from "../stores/guides";
import { useProjectStore } from "../stores/project";
import AdvancedInspector from "./AdvancedInspector.vue";
import LayoutCanvas from "./LayoutCanvas.vue";
import ZoomControl from "./ZoomControl.vue";

const props = defineProps<{
  pageSize: PageSizePt;
  previews: PreviewState[];
}>();

const layoutStore = useLayoutStore();
const guideStore = useGuideStore();
const projectStore = useProjectStore();
const canvas = ref<InstanceType<typeof LayoutCanvas>>();
const fullscreenCanvas = ref<InstanceType<typeof LayoutCanvas>>();
const fullscreenHost = ref<HTMLElement>();
const draftPagesPerColumn = ref(String(layoutStore.pagesPerColumn));
const zoom = ref(1);
const fullscreenZoom = ref(1);
const fullscreenPreviewOpen = ref(false);
let nativeFullscreenActive = false;
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

function stepPagesPerColumn(delta: number) {
  const draftValue = Number(draftPagesPerColumn.value);
  const currentValue = Number.isInteger(draftValue)
    ? draftValue
    : layoutStore.pagesPerColumn;
  draftPagesPerColumn.value = String(Math.max(1, currentValue + delta));
  applyAutomaticLayout();
}

function displayZoom(scale: number): string {
  return Number((scale * 100).toFixed(6)).toString();
}

async function openFullscreenPreview() {
  fullscreenPreviewOpen.value = true;
  document.body.classList.add("fullscreen-preview-open");
  await nextTick();
  fullscreenCanvas.value?.fitContent();

  const host = fullscreenHost.value;
  if (!host?.requestFullscreen) return;
  nativeFullscreenActive = true;
  try {
    await host.requestFullscreen();
    await nextTick();
    fullscreenCanvas.value?.fitContent();
  } catch {
    nativeFullscreenActive = false;
  }
}

async function closeFullscreenPreview() {
  nativeFullscreenActive = false;
  if (document.fullscreenElement === fullscreenHost.value && document.exitFullscreen) {
    try {
      await document.exitFullscreen();
    } catch {
      // The fixed overlay remains a complete fallback when native fullscreen exits itself.
    }
  }
  fullscreenPreviewOpen.value = false;
  document.body.classList.remove("fullscreen-preview-open");
}

function handleFullscreenChange() {
  if (!nativeFullscreenActive || document.fullscreenElement === fullscreenHost.value) return;
  nativeFullscreenActive = false;
  fullscreenPreviewOpen.value = false;
  document.body.classList.remove("fullscreen-preview-open");
}

function handlePreviewKeyDown(event: KeyboardEvent) {
  if (event.code !== "Escape" || !fullscreenPreviewOpen.value) return;
  event.preventDefault();
  void closeFullscreenPreview();
}

watch(
  () => layoutStore.pagesPerColumn,
  (value) => {
    draftPagesPerColumn.value = String(value);
  },
);

onMounted(() => {
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  window.addEventListener("keydown", handlePreviewKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  window.removeEventListener("keydown", handlePreviewKeyDown);
  document.body.classList.remove("fullscreen-preview-open");
  if (document.fullscreenElement === fullscreenHost.value && document.exitFullscreen) {
    void document.exitFullscreen().catch(() => undefined);
  }
});
</script>

<template>
  <section class="layout-editor">
    <div class="layout-toolbar">
      <label>
        <span>每列页数</span>
        <div class="pages-per-column-stepper">
          <button
            type="button"
            aria-label="减少每列页数"
            :disabled="Number(draftPagesPerColumn) <= 1"
            @click="stepPagesPerColumn(-1)"
          >
            −
          </button>
          <input
            v-model="draftPagesPerColumn"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            aria-label="每列页数"
            aria-describedby="layout-input-error"
            @change="applyAutomaticLayout"
            @keydown.enter="applyAutomaticLayout"
          />
          <button
            type="button"
            aria-label="增加每列页数"
            @click="stepPagesPerColumn(1)"
          >
            ＋
          </button>
        </div>
      </label>
      <button type="button" class="ghost-button" @click="applyAutomaticLayout">
        自动排列
      </button>
      <span class="layout-toolbar__summary">{{ layoutSummary }}</span>
      <span v-if="layoutStore.detectedPagesPerColumn" class="guide-success">
        红线识别：每列 {{ layoutStore.detectedPagesPerColumn }} 页
      </span>
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
          <div class="canvas-preview-actions">
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
            <ZoomControl :scale="zoom" @set-zoom="canvas?.setZoom($event)" />
            <button
              type="button"
              class="compact-button"
              @click="openFullscreenPreview"
            >
              全屏预览
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
          <span>缩放 {{ displayZoom(zoom) }}%</span>
          <span>
            {{ guideStore.previewMode === 'cropped' ? '成品裁切预览' : '完整页面预览' }} ·
            拖动成员吸附重排 · 双击删除空白 · 滚轮缩放 · 空格键平移
          </span>
        </footer>
      </div>

      <AdvancedInspector :page-size="props.pageSize" />
    </div>

    <section
      v-if="fullscreenPreviewOpen && layoutStore.layout"
      ref="fullscreenHost"
      class="fullscreen-preview"
      role="dialog"
      aria-modal="true"
      aria-label="全屏版图预览"
    >
      <header class="fullscreen-preview__toolbar">
        <div class="fullscreen-preview__title">
          <span class="eyebrow">全屏预览</span>
          <strong>{{ layoutSummary }}</strong>
        </div>
        <div class="fullscreen-preview__actions">
          <div class="mode-switch" role="group" aria-label="全屏预览模式">
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
          <ZoomControl
            :scale="fullscreenZoom"
            @set-zoom="fullscreenCanvas?.setZoom($event)"
          />
          <button
            type="button"
            class="compact-button"
            @click="fullscreenCanvas?.fitContent()"
          >
            适合内容
          </button>
          <button
            type="button"
            class="primary-button fullscreen-preview__close"
            @click="closeFullscreenPreview"
          >
            退出全屏
          </button>
        </div>
      </header>

      <LayoutCanvas
        ref="fullscreenCanvas"
        class="fullscreen-preview__canvas"
        :layout="layoutStore.layout"
        :page-size="props.pageSize"
        :previews="props.previews"
        :guides="activeGuides"
        :initial-camera="undefined"
        :editable="false"
        @zoom-change="fullscreenZoom = $event"
      />

      <footer class="fullscreen-preview__status">
        <span>缩放 {{ displayZoom(fullscreenZoom) }}%</span>
        <span>只读预览 · 滚轮缩放 · 空格键或鼠标中键平移 · Esc 退出</span>
      </footer>
    </section>
  </section>
</template>
