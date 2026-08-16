<script setup lang="ts">
import { flattenLayout, rotateQuarterTurn, type PageSizePt } from "@pdf2plt/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useResolvedSettings } from "../composables/use-resolved-settings";
import { useDocumentSession } from "../stores/document-session";
import type { PreviewState } from "../stores/pdf-document";
import { usePreviewAppearanceStore } from "../stores/preview-appearance";
import AdvancedInspector from "./AdvancedInspector.vue";
import LayoutCanvas from "./LayoutCanvas.vue";
import PreviewAppearanceControl from "./PreviewAppearanceControl.vue";
import ZoomControl from "./ZoomControl.vue";

const props = defineProps<{
  pageSize: PageSizePt;
  previews: PreviewState[];
}>();
const emit = defineEmits<{ reload: [] }>();

const session = useDocumentSession();
const { documentStore, layoutStore, guideStore, projectStore } = session;
const previewAppearance = usePreviewAppearanceStore();
const canvas = ref<InstanceType<typeof LayoutCanvas>>();
const fullscreenCanvas = ref<InstanceType<typeof LayoutCanvas>>();
const draftPagesPerColumn = ref(String(layoutStore.pagesPerColumn));
const zoom = ref(1);
const fullscreenZoom = ref(1);
const fullscreenPreviewOpen = ref(false);
let nativeWindowFullscreenActive = false;
let fullscreenTransition = 0;
const resolvedSettings = useResolvedSettings(() => props.pageSize, () => session);

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
    session.markDirty();
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
  return (scale * 100).toFixed(2);
}

function applyLayoutMutation(change: () => boolean) {
  if (change()) session.markDirty();
}

function rotateOutput(direction: -1 | 1) {
  projectStore.setOutputSettings({
    ...projectStore.outputSettings,
    rotation: rotateQuarterTurn(projectStore.outputSettings.rotation ?? 0, direction),
  });
  session.markDirty();
}

async function openFullscreenPreview() {
  const transition = ++fullscreenTransition;
  fullscreenPreviewOpen.value = true;
  document.body.classList.add("fullscreen-preview-open");
  await nextTick();
  fullscreenCanvas.value?.fitContent();

  try {
    await getCurrentWindow().setFullscreen(true);
    if (transition !== fullscreenTransition || !fullscreenPreviewOpen.value) {
      await getCurrentWindow().setFullscreen(false).catch(() => undefined);
      return;
    }
    nativeWindowFullscreenActive = true;
    await nextTick();
    fullscreenCanvas.value?.fitContent();
  } catch {
    nativeWindowFullscreenActive = false;
  }
}

async function closeFullscreenPreview() {
  fullscreenTransition += 1;
  const shouldExitNativeFullscreen = nativeWindowFullscreenActive;
  nativeWindowFullscreenActive = false;
  if (shouldExitNativeFullscreen) {
    try {
      await getCurrentWindow().setFullscreen(false);
    } catch {
      // The fixed overlay can still be closed if the window manager already left fullscreen.
    }
  }
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

watch(
  () => layoutStore.layout,
  (layout) => {
    if (!layout) return;
    const pageNumbers = [
      ...new Set(
        flattenLayout(layout).flatMap((cell) =>
          cell?.kind === "page" ? [cell.pageNumber] : [],
        ),
      ),
    ];
    documentStore.setPreviewCacheLimit(Math.max(18, pageNumbers.length));
    documentStore.prioritizePreviews(pageNumbers);
  },
  { deep: true, immediate: true },
);

onMounted(() => {
  window.addEventListener("keydown", handlePreviewKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handlePreviewKeyDown);
  document.body.classList.remove("fullscreen-preview-open");
  fullscreenTransition += 1;
  if (nativeWindowFullscreenActive) {
    nativeWindowFullscreenActive = false;
    void getCurrentWindow().setFullscreen(false).catch(() => undefined);
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
      <button
        type="button"
        class="ghost-button layout-refresh-button"
        aria-label="重新自动排列"
        title="重新打开 PDF 并自动排列"
        @click="emit('reload')"
      >
        <svg class="refresh-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M13.5 5.8A5.8 5.8 0 0 0 3.1 3.7L1.8 5" />
          <path d="M1.8 2.3V5h2.7" />
          <path d="M2.5 10.2a5.8 5.8 0 0 0 10.4 2.1l1.3-1.3" />
          <path d="M14.2 13.7V11h-2.7" />
        </svg>
      </button>
      <span class="layout-toolbar__summary">{{ layoutSummary }}</span>
      <span v-if="layoutStore.detectedPagesPerColumn" class="guide-success">
        {{ documentStore.guideDetection?.contentOverlap?.applied ? '内容匹配' : '辅助线识别' }}：每列 {{ layoutStore.detectedPagesPerColumn }} 页
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
        @click="applyLayoutMutation(() => layoutStore.undo())"
      >
        撤销
      </button>
      <button
        type="button"
        class="compact-button"
        :disabled="!layoutStore.canRedo"
        @click="applyLayoutMutation(() => layoutStore.redo())"
      >
        重做
      </button>
      <span class="command-separator" />
      <button
        type="button"
        class="compact-button"
        aria-label="增加一行"
        @click="applyLayoutMutation(() => layoutStore.addRow())"
      >
        + 行
      </button>
      <button
        type="button"
        class="compact-button"
        aria-label="删除最后一行"
        @click="applyLayoutMutation(() => layoutStore.removeLastRow())"
      >
        − 行
      </button>
      <button
        type="button"
        class="compact-button"
        aria-label="增加一列"
        @click="applyLayoutMutation(() => layoutStore.addColumn())"
      >
        + 列
      </button>
      <button
        type="button"
        class="compact-button"
        aria-label="删除最后一列"
        @click="applyLayoutMutation(() => layoutStore.removeLastColumn())"
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
                :class="{ active: guideStore.previewMode === 'cropped' }"
                :disabled="!resolvedSettings.resolved.value.value"
                @click="guideStore.setPreviewModeValidated('cropped', Boolean(resolvedSettings.resolved.value.value))"
              >
                成品裁切
              </button>
              <button
                type="button"
                :class="{ active: guideStore.previewMode === 'full' }"
                @click="guideStore.setPreviewModeValidated('full', true)"
              >
                完整页面
              </button>
            </div>
            <label class="check-row grid-visibility-toggle">
              <input v-model="session.ui.showGrid" type="checkbox" />
              显示栅格
            </label>
            <div class="mode-switch rotation-switch" role="group" aria-label="成品旋转">
              <button
                type="button"
                class="rotation-icon-button"
                aria-label="向左旋转 90 度"
                title="向左旋转 90°"
                @click="rotateOutput(-1)"
              >
                <svg class="rotation-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4.1 5.3H1.7V2.9" />
                  <path d="M2 5.1a6 6 0 1 1-.1 5.6" />
                </svg>
              </button>
              <span class="rotation-angle" aria-live="polite">
                {{ projectStore.outputSettings.rotation ?? 0 }}°
              </span>
              <button
                type="button"
                class="rotation-icon-button"
                aria-label="向右旋转 90 度"
                title="向右旋转 90°"
                @click="rotateOutput(1)"
              >
                <svg class="rotation-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M11.9 5.3h2.4V2.9" />
                  <path d="M14 5.1a6 6 0 1 0 .1 5.6" />
                </svg>
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

        <PreviewAppearanceControl />

        <LayoutCanvas
          v-if="layoutStore.layout"
          ref="canvas"
          :layout="layoutStore.layout"
          :page-size="props.pageSize"
          :previews="props.previews"
          :guides="activeGuides"
          :show-grid="session.ui.showGrid"
          :foreground-color="previewAppearance.foregroundColor"
          :background-color="previewAppearance.backgroundColor"
          :line-weight="previewAppearance.lineWeight"
          :rotation="projectStore.outputSettings.rotation ?? 0"
          :render-region="documentStore.renderRegion"
          :initial-camera="initialCamera"
          @zoom-change="zoom = $event"
          @view-change="projectStore.setView"
          @move-page="(pageNumber, target) => applyLayoutMutation(() => layoutStore.movePageTo(pageNumber, target))"
          @insert-spacer="(target) => applyLayoutMutation(() => layoutStore.insertSpacer(target))"
          @move-spacer="(spacerId, target) => applyLayoutMutation(() => layoutStore.moveSpacerTo(spacerId, target))"
          @delete-spacer="(spacerId) => applyLayoutMutation(() => layoutStore.deleteSpacer(spacerId))"
          @canvas-preview-request="documentStore.requestCanvasPreviews"
        />

        <footer class="canvas-status">
          <span>缩放 {{ displayZoom(zoom) }}%</span>
          <span>
            {{ guideStore.previewMode === 'cropped' ? '成品裁切预览' : '完整页面预览' }} ·
            左键平移 · 右键拖动成员吸附重排 · 按住空格局部放大（滚轮调倍数） · 双击删除空白 · 滚轮滚动 · Ctrl＋滚轮缩放 · Ctrl＋Shift＋滚轮微调
          </span>
        </footer>
      </div>

      <AdvancedInspector :page-size="props.pageSize" />
    </div>

    <section
      v-if="fullscreenPreviewOpen && layoutStore.layout"
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
              :class="{ active: guideStore.previewMode === 'cropped' }"
              :disabled="!resolvedSettings.resolved.value.value"
              @click="guideStore.setPreviewModeValidated('cropped', Boolean(resolvedSettings.resolved.value.value))"
            >
              成品裁切
            </button>
            <button
              type="button"
              :class="{ active: guideStore.previewMode === 'full' }"
              @click="guideStore.setPreviewModeValidated('full', true)"
            >
              完整页面
            </button>
          </div>
          <label class="check-row grid-visibility-toggle">
            <input v-model="session.ui.showGrid" type="checkbox" />
            显示栅格
          </label>
          <div class="mode-switch rotation-switch" role="group" aria-label="全屏成品旋转">
            <button
              type="button"
              class="rotation-icon-button"
              aria-label="全屏向左旋转 90 度"
              title="向左旋转 90°"
              @click="rotateOutput(-1)"
            >
              <svg class="rotation-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.1 5.3H1.7V2.9" />
                <path d="M2 5.1a6 6 0 1 1-.1 5.6" />
              </svg>
            </button>
            <span class="rotation-angle" aria-live="polite">
              {{ projectStore.outputSettings.rotation ?? 0 }}°
            </span>
            <button
              type="button"
              class="rotation-icon-button"
              aria-label="全屏向右旋转 90 度"
              title="向右旋转 90°"
              @click="rotateOutput(1)"
            >
              <svg class="rotation-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M11.9 5.3h2.4V2.9" />
                <path d="M14 5.1a6 6 0 1 0 .1 5.6" />
              </svg>
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
        :show-grid="session.ui.showGrid"
        :foreground-color="previewAppearance.foregroundColor"
        :background-color="previewAppearance.backgroundColor"
        :line-weight="previewAppearance.lineWeight"
        :rotation="projectStore.outputSettings.rotation ?? 0"
        :render-region="documentStore.renderRegion"
        :initial-camera="undefined"
        :editable="false"
        @zoom-change="fullscreenZoom = $event"
        @canvas-preview-request="documentStore.requestCanvasPreviews"
      />

      <footer class="fullscreen-preview__status">
        <span>缩放 {{ displayZoom(fullscreenZoom) }}%</span>
        <span>只读预览 · 左键平移 · 按住空格局部放大（滚轮调倍数） · Ctrl＋滚轮缩放 · Esc 退出</span>
      </footer>
    </section>
  </section>
</template>
