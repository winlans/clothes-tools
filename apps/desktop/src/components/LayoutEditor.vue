<script setup lang="ts">
import {
  flattenLayout,
  rotateQuarterTurn,
  type PageSizePt,
  type VectorBrushStroke,
  type VectorObjectExclusionRule,
  type VectorPaintKind,
  type VectorSelectionPreview,
} from "@pdf2plt/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Maximize2Icon,
  PaintbrushIcon,
  Redo2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SquareDashedIcon,
  Undo2Icon,
} from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useResolvedSettings } from "../composables/use-resolved-settings";
import { useDocumentSession } from "../stores/document-session";
import type { PreviewState } from "../stores/pdf-document";
import { usePreviewAppearanceStore } from "../stores/preview-appearance";
import AdvancedInspector from "./AdvancedInspector.vue";
import IconButton from "./IconButton.vue";
import LayoutCanvas from "./LayoutCanvas.vue";
import PreviewAppearanceControl from "./PreviewAppearanceControl.vue";
import StitchingCalculationOverlay from "./StitchingCalculationOverlay.vue";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ButtonGroup, ButtonGroupText } from "./ui/button-group";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Separator } from "./ui/separator";
import { Slider } from "./ui/slider";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
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
const brushEnabled = ref(false);
const brushOperation = ref<VectorBrushStroke["operation"]>("add");
const brushRadiusPt = ref(12);
const brushScope = ref<VectorObjectExclusionRule["scope"]>("all-pages");
const brushStrokes = ref<VectorBrushStroke[]>([]);
const brushObjectKinds = ref<VectorPaintKind[]>([]);
const brushSourcePageNumber = ref<number>();
const selectionOverlays = ref<PreviewState[]>([]);
const selectedObjectCount = ref(0);
const selectionReady = ref(false);
const brushError = ref("");
let brushRevision = 0;
let nextBrushRuleId = 1;
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
const savedExclusionRules = computed(
  () => projectStore.outputSettings.objectExclusions ?? [],
);

function disposeSelectionOverlays() {
  for (const overlay of selectionOverlays.value) URL.revokeObjectURL(overlay.url);
  selectionOverlays.value = [];
}

function setSelectionResults(results: readonly VectorSelectionPreview[]) {
  disposeSelectionOverlays();
  selectedObjectCount.value = results.reduce(
    (total, result) => total + result.selectedObjects.length,
    0,
  );
  selectionOverlays.value = results
    .filter((result) => result.selectedObjects.length > 0)
    .map((result) => ({
      pageNumber: result.pageNumber,
      width: props.pageSize.width,
      height: props.pageSize.height,
      url: URL.createObjectURL(new Blob(
        [result.overlaySvg],
        { type: "image/svg+xml;charset=utf-8" },
      )),
      format: "svg" as const,
    }));
}

function currentBrushRule(includeLearnedKinds = true): VectorObjectExclusionRule | undefined {
  const sourcePageNumber = brushSourcePageNumber.value;
  if (!sourcePageNumber || !brushStrokes.value.some((stroke) => stroke.operation === "add")) {
    return undefined;
  }
  return {
    id: `brush-${Date.now()}-${nextBrushRuleId}`,
    sourcePageNumber,
    scope: brushScope.value,
    ...(includeLearnedKinds && brushObjectKinds.value.length > 0
      ? { objectKinds: [...brushObjectKinds.value] }
      : {}),
    strokes: brushStrokes.value.map((stroke) => ({
      operation: stroke.operation,
      radiusPt: stroke.radiusPt,
      points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
    })),
  };
}

async function analyzeBrush(pageNumbers: number[], applied: boolean) {
  const rule = currentBrushRule(applied);
  if (!rule) {
    brushError.value = "请先用加选画笔选择至少一个对象。";
    return;
  }
  const revision = ++brushRevision;
  brushError.value = "";
  try {
    const results = await documentStore.analyzeVectorExclusion(rule, pageNumbers);
    if (revision !== brushRevision || !brushEnabled.value) return;
    setSelectionResults(results);
    selectionReady.value = selectedObjectCount.value > 0;
    if (!applied) {
      brushObjectKinds.value = [...new Set(
        results.flatMap((result) => result.selectedObjects.map((object) => object.kind)),
      )];
    }
    if (selectedObjectCount.value === 0) {
      brushError.value = "当前画笔没有命中可消除的矢量对象。";
    }
  } catch (error) {
    if (revision !== brushRevision) return;
    brushError.value = error instanceof Error ? error.message : "画笔识别失败。";
  }
}

function startBrushMode() {
  brushEnabled.value = true;
  brushOperation.value = "add";
  brushScope.value = "all-pages";
  brushStrokes.value = [];
  brushObjectKinds.value = [];
  brushSourcePageNumber.value = undefined;
  selectedObjectCount.value = 0;
  selectionReady.value = false;
  brushError.value = "";
  disposeSelectionOverlays();
}

function cancelBrushMode() {
  brushRevision += 1;
  documentStore.cancelSelection();
  brushEnabled.value = false;
  brushStrokes.value = [];
  brushObjectKinds.value = [];
  brushSourcePageNumber.value = undefined;
  selectedObjectCount.value = 0;
  selectionReady.value = false;
  brushError.value = "";
  disposeSelectionOverlays();
}

function handleBrushStroke(pageNumber: number, stroke: VectorBrushStroke) {
  if (documentStore.selectionStatus === "running") return;
  if (
    brushSourcePageNumber.value !== undefined &&
    brushSourcePageNumber.value !== pageNumber
  ) {
    brushError.value = "一条消除规则只能在同一个参考页调整；请确认或取消当前规则。";
    return;
  }
  if (stroke.operation === "subtract" && brushSourcePageNumber.value === undefined) {
    brushError.value = "请先使用加选画笔选择对象。";
    return;
  }
  brushSourcePageNumber.value ??= pageNumber;
  brushStrokes.value = [
    ...brushStrokes.value,
    {
      operation: stroke.operation,
      radiusPt: stroke.radiusPt,
      points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
    },
  ];
  brushObjectKinds.value = [];
  selectionReady.value = false;
  void analyzeBrush([pageNumber], false);
}

function undoBrushStroke() {
  if (brushStrokes.value.length === 0 || documentStore.selectionStatus === "running") return;
  brushStrokes.value = brushStrokes.value.slice(0, -1);
  brushObjectKinds.value = [];
  selectionReady.value = false;
  if (!brushStrokes.value.some((stroke) => stroke.operation === "add")) {
    brushSourcePageNumber.value = undefined;
    selectedObjectCount.value = 0;
    brushError.value = "";
    disposeSelectionOverlays();
    return;
  }
  if (brushSourcePageNumber.value) {
    void analyzeBrush([brushSourcePageNumber.value], false);
  }
}

function previewBrushMatches() {
  const sourcePageNumber = brushSourcePageNumber.value;
  if (!sourcePageNumber) {
    brushError.value = "请先在参考页上涂选对象。";
    return;
  }
  const pageNumbers = brushScope.value === "all-pages"
    ? documentStore.info?.pages.map((page) => page.pageNumber) ?? []
    : [sourcePageNumber];
  void analyzeBrush(pageNumbers, true);
}

function confirmBrushRule() {
  const rule = currentBrushRule();
  if (!rule || !selectionReady.value || selectedObjectCount.value === 0) {
    brushError.value = "请先在参考页上涂选并检查红色标记结果。";
    return;
  }
  nextBrushRuleId += 1;
  projectStore.setOutputSettings({
    ...projectStore.outputSettings,
    objectExclusions: [
      ...(projectStore.outputSettings.objectExclusions ?? []),
      rule,
    ],
  });
  session.markDirty();
  cancelBrushMode();
}

function removeExclusionRule(id: string) {
  projectStore.setOutputSettings({
    ...projectStore.outputSettings,
    objectExclusions: savedExclusionRules.value.filter((rule) => rule.id !== id),
  });
  session.markDirty();
}

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

function startSpacerDrag(event: DragEvent) {
  event.dataTransfer?.setData("application/x-pdf2plt-spacer", "new");
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

function setPreviewMode(value: unknown) {
  if (value === "cropped") {
    guideStore.setPreviewModeValidated(
      "cropped",
      Boolean(resolvedSettings.resolved.value.value),
    );
  } else if (value === "full") {
    guideStore.setPreviewModeValidated("full", true);
  }
}

function setBrushOperation(value: unknown) {
  if (value === "add" || value === "subtract") brushOperation.value = value;
}

function setBrushScope(value?: unknown) {
  if (value === "all-pages" || value === "current-page") brushScope.value = value;
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
  brushRevision += 1;
  documentStore.cancelSelection();
  disposeSelectionOverlays();
  if (nativeWindowFullscreenActive) {
    nativeWindowFullscreenActive = false;
    void getCurrentWindow().setFullscreen(false).catch(() => undefined);
  }
});
</script>

<template>
  <section class="layout-editor">
    <div class="workspace-control-panel">
      <div class="workspace-control-row workspace-control-row--layout">
        <div class="layout-toolbar">
          <label>
            <span>每列页数</span>
            <ButtonGroup class="pages-per-column-stepper">
              <Button
                variant="outline"
                size="icon"
                aria-label="减少每列页数"
                :disabled="Number(draftPagesPerColumn) <= 1"
                @click="stepPagesPerColumn(-1)"
              >
                −
              </Button>
              <Input
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
              <Button
                variant="outline"
                size="icon"
                aria-label="增加每列页数"
                @click="stepPagesPerColumn(1)"
              >
                ＋
              </Button>
            </ButtonGroup>
          </label>
          <IconButton
            variant="outline"
            size="icon"
            class="layout-refresh-button"
            aria-label="重新自动排列"
            tooltip="重新打开 PDF 并自动排列"
            @click="emit('reload')"
          >
            <RefreshCwIcon />
          </IconButton>
          <span class="layout-toolbar__summary">{{ layoutSummary }}</span>
          <Badge v-if="layoutStore.detectedPagesPerColumn" variant="secondary" class="guide-success">
            {{ documentStore.guideDetection?.contentOverlap?.applied ? '内容匹配' : '辅助线识别' }}：每列 {{ layoutStore.detectedPagesPerColumn }} 页
          </Badge>
        </div>

        <ButtonGroup class="layout-commandbar" aria-label="布局编辑命令">
          <Button
            variant="outline"
            :disabled="!layoutStore.canUndo"
            @click="applyLayoutMutation(() => layoutStore.undo())"
          >
            <Undo2Icon />
            撤销
          </Button>
          <Button
            variant="outline"
            :disabled="!layoutStore.canRedo"
            @click="applyLayoutMutation(() => layoutStore.redo())"
          >
            <Redo2Icon />
            重做
          </Button>
          <Separator orientation="vertical" class="command-separator" />
          <Button
            variant="outline"
            class="spacer-tool-button"
            draggable="true"
            aria-label="拖动插入空白块"
            title="拖到画板格子中插入空白占位"
            @dragstart="startSpacerDrag"
          >
            <SquareDashedIcon />
            空白块
          </Button>
          <Button
            variant="outline"
            aria-label="增加一行"
            @click="applyLayoutMutation(() => layoutStore.addRow())"
          >
            + 行
          </Button>
          <Button
            variant="outline"
            aria-label="删除最后一行"
            @click="applyLayoutMutation(() => layoutStore.removeLastRow())"
          >
            − 行
          </Button>
          <Button
            variant="outline"
            aria-label="增加一列"
            @click="applyLayoutMutation(() => layoutStore.addColumn())"
          >
            + 列
          </Button>
          <Button
            variant="outline"
            aria-label="删除最后一列"
            @click="applyLayoutMutation(() => layoutStore.removeLastColumn())"
          >
            − 列
          </Button>
        </ButtonGroup>
      </div>

      <div class="workspace-control-row workspace-control-row--preview">
        <div class="canvas-preview-switch">
          <span class="eyebrow">画板预览</span>
          <div class="canvas-preview-actions">
            <ToggleGroup
              type="single"
              variant="outline"
              :model-value="guideStore.previewMode"
              aria-label="预览模式"
              @update:model-value="setPreviewMode"
            >
              <ToggleGroupItem
                value="cropped"
                :disabled="!resolvedSettings.resolved.value.value"
              >
                成品裁切
              </ToggleGroupItem>
              <ToggleGroupItem value="full">
                完整页面
              </ToggleGroupItem>
            </ToggleGroup>
            <label class="check-row grid-visibility-toggle">
              <Checkbox
                :model-value="session.ui.showGrid"
                @update:model-value="session.ui.showGrid = Boolean($event)"
              />
              显示栅格
            </label>
            <ButtonGroup class="rotation-switch" aria-label="成品旋转">
              <IconButton
                variant="outline"
                size="icon"
                aria-label="向左旋转 90 度"
                tooltip="向左旋转 90°"
                @click="rotateOutput(-1)"
              >
                <RotateCcwIcon />
              </IconButton>
              <ButtonGroupText class="rotation-angle" aria-live="polite">
                {{ projectStore.outputSettings.rotation ?? 0 }}°
              </ButtonGroupText>
              <IconButton
                variant="outline"
                size="icon"
                aria-label="向右旋转 90 度"
                tooltip="向右旋转 90°"
                @click="rotateOutput(1)"
              >
                <RotateCwIcon />
              </IconButton>
            </ButtonGroup>
            <Button
              :variant="brushEnabled ? 'secondary' : 'outline'"
              aria-label="画笔消除"
              @click="brushEnabled ? cancelBrushMode() : startBrushMode()"
            >
              <PaintbrushIcon />
              {{ brushEnabled ? '退出画笔' : '画笔消除' }}
            </Button>
            <ZoomControl :scale="zoom" @set-zoom="canvas?.setZoom($event)" />
            <Button variant="outline" @click="canvas?.fitContent()">
              适合内容
            </Button>
            <Button
              variant="outline"
              @click="openFullscreenPreview"
            >
              <Maximize2Icon />
              全屏预览
            </Button>
            <PreviewAppearanceControl />
          </div>
        </div>
      </div>
    </div>

    <div v-if="brushEnabled" class="brush-removal-toolbar" aria-label="画笔消除工具">
      <ToggleGroup
        type="single"
        variant="outline"
        :model-value="brushOperation"
        aria-label="画笔操作"
        @update:model-value="setBrushOperation"
      >
        <ToggleGroupItem
          value="add"
          :disabled="documentStore.selectionStatus === 'running'"
        >
          加选
        </ToggleGroupItem>
        <ToggleGroupItem
          value="subtract"
          :disabled="documentStore.selectionStatus === 'running'"
        >
          减选
        </ToggleGroupItem>
      </ToggleGroup>
      <label class="brush-size-control">
        <span>笔刷半径</span>
        <Slider
          :min="2"
          :max="40"
          :step="1"
          :model-value="[brushRadiusPt]"
          :disabled="documentStore.selectionStatus === 'running'"
          @update:model-value="brushRadiusPt = $event?.[0] ?? brushRadiusPt"
        />
        <output>{{ brushRadiusPt }} pt</output>
      </label>
      <label>
        <span>生效范围</span>
        <NativeSelect
          :model-value="brushScope"
          aria-label="画笔消除生效范围"
          :disabled="documentStore.selectionStatus === 'running'"
          @update:model-value="setBrushScope"
        >
          <NativeSelectOption value="all-pages">全部页面</NativeSelectOption>
          <NativeSelectOption value="current-page">仅参考页</NativeSelectOption>
        </NativeSelect>
      </label>
      <span class="brush-selection-summary" role="status">
        <template v-if="documentStore.selectionStatus === 'running'">
          正在识别 {{ documentStore.selectionProgress.completed }}/{{ documentStore.selectionProgress.total }} 页
        </template>
        <template v-else>
          {{ brushSourcePageNumber ? `参考页 ${brushSourcePageNumber}` : '请在一个页面上涂选' }} ·
          已标记 {{ selectedObjectCount }} 个对象
        </template>
      </span>
      <Button
        variant="outline"
        :disabled="brushStrokes.length === 0 || documentStore.selectionStatus === 'running'"
        @click="undoBrushStroke"
      >
        撤销一笔
      </Button>
      <Button
        v-if="documentStore.selectionStatus === 'running'"
        variant="outline"
        @click="documentStore.cancelSelection()"
      >
        取消识别
      </Button>
      <Button
        v-else
        variant="outline"
        :aria-label="brushScope === 'all-pages' ? '预览全部页面匹配结果' : '预览参考页匹配结果'"
        :title="brushScope === 'all-pages' ? '预览全部页面匹配结果' : '预览参考页匹配结果'"
        :disabled="!brushSourcePageNumber"
        @click="previewBrushMatches"
      >
        预览匹配
      </Button>
      <Button
        :disabled="!selectionReady || selectedObjectCount === 0 || documentStore.selectionStatus === 'running'"
        @click="confirmBrushRule"
      >
        确认消除
      </Button>
      <Button variant="outline" @click="cancelBrushMode">取消</Button>
    </div>

    <div v-if="savedExclusionRules.length" class="saved-exclusion-rules" aria-label="已保存消除规则">
      <span class="eyebrow">已保存消除规则</span>
      <Button
        v-for="(rule, index) in savedExclusionRules"
        :key="rule.id"
        variant="outline"
        :aria-label="`删除消除规则 ${index + 1}`"
        @click="removeExclusionRule(rule.id)"
      >
        规则 {{ index + 1 }} · {{ rule.scope === 'all-pages' ? '全部页面' : `第 ${rule.sourcePageNumber} 页` }} ×
      </Button>
    </div>

    <Alert v-if="brushError" variant="destructive" role="alert">
      <AlertDescription>{{ brushError }}</AlertDescription>
    </Alert>

    <Alert
      v-if="layoutStore.errorMessage"
      id="layout-input-error"
      variant="destructive"
      role="alert"
    >
      <AlertDescription>{{ layoutStore.errorMessage }}</AlertDescription>
    </Alert>
    <Alert v-if="guideStore.errorMessage" variant="destructive" role="alert">
      <AlertDescription>{{ guideStore.errorMessage }}</AlertDescription>
    </Alert>

    <div class="layout-editor__body">
      <div class="canvas-column">
        <div class="layout-canvas-shell">
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
            :brush-enabled="brushEnabled"
            :brush-locked="documentStore.selectionStatus === 'running'"
            :brush-operation="brushOperation"
            :brush-radius-pt="brushRadiusPt"
            :brush-strokes="brushStrokes"
            :brush-source-page-number="brushSourcePageNumber"
            :selection-overlays="selectionOverlays"
            @zoom-change="zoom = $event"
            @view-change="projectStore.setView"
            @move-page="(pageNumber, target) => applyLayoutMutation(() => layoutStore.movePageTo(pageNumber, target))"
            @insert-spacer="(target) => applyLayoutMutation(() => layoutStore.insertSpacer(target))"
            @move-spacer="(spacerId, target) => applyLayoutMutation(() => layoutStore.moveSpacerTo(spacerId, target))"
            @delete-spacer="(spacerId) => applyLayoutMutation(() => layoutStore.deleteSpacer(spacerId))"
            @canvas-preview-request="documentStore.requestCanvasPreviews"
            @brush-stroke="handleBrushStroke"
          />
          <StitchingCalculationOverlay
            v-if="documentStore.detectionStatus === 'running'"
            :phase="documentStore.detectionProgress.phase"
            :completed="documentStore.detectionProgress.completed"
            :total="documentStore.detectionProgress.total"
          />
        </div>

        <footer class="canvas-status">
          <span>缩放 {{ displayZoom(zoom) }}%</span>
          <span>
            {{ guideStore.previewMode === 'cropped' ? '成品裁切预览' : '完整页面预览' }} ·
            <template v-if="brushEnabled">左键画笔加选/减选 · </template>
            <template v-else>左键平移 · 右键拖动成员吸附重排 · </template>
            按住空格局部放大（滚轮调倍数） · 双击删除空白 · 滚轮滚动 · Ctrl＋滚轮缩放 · Ctrl＋Shift＋滚轮微调
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
          <ToggleGroup
            type="single"
            variant="outline"
            :model-value="guideStore.previewMode"
            aria-label="全屏预览模式"
            @update:model-value="setPreviewMode"
          >
            <ToggleGroupItem
              value="cropped"
              :disabled="!resolvedSettings.resolved.value.value"
            >
              成品裁切
            </ToggleGroupItem>
            <ToggleGroupItem value="full">
              完整页面
            </ToggleGroupItem>
          </ToggleGroup>
          <label class="check-row grid-visibility-toggle">
            <Checkbox
              :model-value="session.ui.showGrid"
              @update:model-value="session.ui.showGrid = Boolean($event)"
            />
            显示栅格
          </label>
          <ButtonGroup class="rotation-switch" aria-label="全屏成品旋转">
            <IconButton
              variant="outline"
              size="icon"
              aria-label="全屏向左旋转 90 度"
              tooltip="向左旋转 90°"
              @click="rotateOutput(-1)"
            >
              <RotateCcwIcon />
            </IconButton>
            <ButtonGroupText class="rotation-angle" aria-live="polite">
              {{ projectStore.outputSettings.rotation ?? 0 }}°
            </ButtonGroupText>
            <IconButton
              variant="outline"
              size="icon"
              aria-label="全屏向右旋转 90 度"
              tooltip="向右旋转 90°"
              @click="rotateOutput(1)"
            >
              <RotateCwIcon />
            </IconButton>
          </ButtonGroup>
          <ZoomControl
            :scale="fullscreenZoom"
            @set-zoom="fullscreenCanvas?.setZoom($event)"
          />
          <Button
            variant="outline"
            @click="fullscreenCanvas?.fitContent()"
          >
            适合内容
          </Button>
          <Button
            class="fullscreen-preview__close"
            @click="closeFullscreenPreview"
          >
            退出全屏
          </Button>
        </div>
      </header>

      <div class="fullscreen-preview__canvas-shell">
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
        <StitchingCalculationOverlay
          v-if="documentStore.detectionStatus === 'running'"
          :phase="documentStore.detectionProgress.phase"
          :completed="documentStore.detectionProgress.completed"
          :total="documentStore.detectionProgress.total"
        />
      </div>

      <footer class="fullscreen-preview__status">
        <span>缩放 {{ displayZoom(fullscreenZoom) }}%</span>
        <span>只读预览 · 左键平移 · 按住空格局部放大（滚轮调倍数） · Ctrl＋滚轮缩放 · Esc 退出</span>
      </footer>
    </section>
  </section>
</template>
