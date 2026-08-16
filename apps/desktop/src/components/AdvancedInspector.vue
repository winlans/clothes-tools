<script setup lang="ts">
import {
  GUIDE_DIRECTIONS,
  resolveGuideDetectionOptions,
  resolveGuideGeometry,
  type GuideDirection,
  type GuideStitchingMode,
  type PageSizePt,
  type ProjectGuideSettings,
  type ProjectOutputSettings,
} from "@pdf2plt/core";
import { computed, reactive, ref, watch } from "vue";

import { useResolvedSettings } from "../composables/use-resolved-settings";
import { formatUiNumber, roundUiNumber } from "../numbers";
import {
  detectedGuideCoordinates,
  guideCoordinateFromInput,
  guideInputValueFromCoordinate,
  guideSettingsFromLines,
} from "../project/guide-settings";
import { useDocumentSession } from "../stores/document-session";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Separator } from "./ui/separator";

const props = defineProps<{ pageSize: PageSizePt }>();
const session = useDocumentSession();
const { documentStore, layoutStore, guideStore, projectStore } = session;
const settings = useResolvedSettings(() => props.pageSize, () => session);
const localError = ref("");
const syncSeamInsets = ref(false);
const usesEdgeInsets = computed(() => projectStore.guideSettings.inputMode === "edge-insets");
const selectedStitchingMode = computed<GuideStitchingMode>(
  () => projectStore.guideSettings.stitchingMode ?? "auto",
);
const detectedStitchingModeText = computed(() => {
  if (!documentStore.guideDetection) return "";
  return documentStore.guideDetection.contentOverlap ? "内容匹配" : "辅助线拼接";
});
const detectionPhaseText = computed(() => {
  if (documentStore.detectionProgress.phase === "content-overlap") return "内容匹配";
  if (documentStore.detectionProgress.phase === "guide-pattern") return "辅助线模式识别";
  return "颜色辅助线识别";
});

const guideLabels: Record<GuideDirection, string> = {
  left: "左",
  right: "右",
  top: "上",
  bottom: "下",
};
const seamDrafts = reactive<Record<GuideDirection, string>>({
  left: "",
  right: "",
  top: "",
  bottom: "",
});
const outerDrafts = reactive({ left: "0", right: "", top: "0", bottom: "" });
const detectionDrafts = reactive({
  dpi: "",
  redMin: "",
  otherMax: "",
  redDelta: "",
  minimumFraction: "",
});

const missingGuideText = computed(() =>
  guideStore.missing.map((direction) => guideLabels[direction]).join("、"),
);
const hasManualGuides = computed(() =>
  GUIDE_DIRECTIONS.some((direction) => guideStore.lines[direction]?.source === "manual"),
);
const outputSizeText = computed(() => {
  const geometry = settings.resolved.value.value?.geometry;
  if (!geometry) return "设置无效";
  return `${((geometry.width * 25.4) / 72).toFixed(2)} × ${((geometry.height * 25.4) / 72).toFixed(2)} mm`;
});
const displayedError = computed(() =>
  localError.value || documentStore.detectionErrorMessage || settings.validationError.value,
);

function draftNumber(value: string): number {
  return roundUiNumber(Number(value));
}

function integerDraftNumber(value: string): number {
  return Math.round(Number(value));
}

function seamFieldLabel(direction: GuideDirection): string {
  return usesEdgeInsets.value
    ? `${guideLabels[direction]}裁切量`
    : `${guideLabels[direction]}拼接线`;
}

function currentSettings(mode = projectStore.guideSettings.mode): ProjectGuideSettings {
  return {
    ...guideSettingsFromLines(projectStore.guideSettings, guideStore.lines),
    mode,
  };
}

function withStitchingMode(
  settings: ProjectGuideSettings,
  stitchingMode: GuideStitchingMode,
): ProjectGuideSettings {
  const next = { ...settings };
  delete next.stitchingMode;
  if (stitchingMode !== "auto") next.stitchingMode = stitchingMode;
  if (stitchingMode === "content-overlap") next.inputMode = "edge-insets";
  if (stitchingMode === "red-guides") delete next.inputMode;
  return next;
}

function withDetectedInputMode(
  settings: ProjectGuideSettings,
  stitchingMode: GuideStitchingMode,
  result: NonNullable<typeof documentStore.guideDetection>,
): ProjectGuideSettings {
  const next = withStitchingMode(settings, stitchingMode);
  if (stitchingMode === "content-overlap" || result.contentOverlap) {
    next.inputMode = "edge-insets";
  } else {
    delete next.inputMode;
  }
  return next;
}

async function redetect() {
  try {
    const options = resolveGuideDetectionOptions({
      dpi: draftNumber(detectionDrafts.dpi),
      redMin: draftNumber(detectionDrafts.redMin),
      otherMax: draftNumber(detectionDrafts.otherMax),
      redDelta: draftNumber(detectionDrafts.redDelta),
      minimumFraction: draftNumber(detectionDrafts.minimumFraction),
    });
    projectStore.setGuideSettings({
      ...currentSettings("auto"),
      detection: options,
    });
    const stitchingMode = selectedStitchingMode.value;
    const result = await documentStore.detectGuides(options, stitchingMode);
    guideStore.applyDetection(documentStore.info?.documentId ?? "", result);
    projectStore.setGuideSettings(withDetectedInputMode({
      ...guideSettingsFromLines(projectStore.guideSettings, guideStore.lines),
      mode: "auto",
    }, stitchingMode, result));
    localError.value = "";
    guideStore.setPreviewModeValidated("cropped", Boolean(settings.resolved.value.value));
    session.markDirty();
  } catch (error) {
    localError.value = documentStore.detectionStatus === "cancelled"
      ? ""
      : error instanceof Error
        ? error.message
        : "拼接识别失败。";
  }
}

function setStitchingMode(value?: unknown) {
  const stitchingMode = String(value) as GuideStitchingMode;
  projectStore.setGuideSettings(withStitchingMode(currentSettings(), stitchingMode));
  localError.value = "";
  session.markDirty();
  void redetect();
}

function handleDetectionAction() {
  if (documentStore.detectionStatus === "running") {
    documentStore.cancelDetection();
    return;
  }
  void redetect();
}

function setSeamCropping(enabled: boolean) {
  localError.value = "";
  const mode = enabled
    ? hasManualGuides.value
      ? "manual"
      : "auto"
    : "none";
  projectStore.setGuideSettings(currentSettings(mode));
  guideStore.setPreviewModeValidated("cropped", Boolean(settings.resolved.value.value));
  session.markDirty();
}

function applyManualGuide(direction: GuideDirection) {
  const draft = String(seamDrafts[direction]).trim();
  const directions = usesEdgeInsets.value && syncSeamInsets.value
    ? GUIDE_DIRECTIONS
    : [direction];
  if (usesEdgeInsets.value && draft === "") {
    for (const target of directions) guideStore.clearManual(target);
    projectStore.setGuideSettings(currentSettings("manual"));
    localError.value = "";
    session.markDirty();
    return;
  }
  const inputValue = draftNumber(draft);
  const applied = directions.every((target) => {
    const coordinatePt = guideCoordinateFromInput(
      target,
      inputValue,
      props.pageSize,
      projectStore.guideSettings.inputMode,
    );
    return guideStore.setManual(target, coordinatePt, props.pageSize, usesEdgeInsets.value);
  });
  if (applied) {
    projectStore.setGuideSettings(currentSettings("manual"));
    localError.value = "";
    session.markDirty();
  }
}

function applyOuterBoundaries() {
  const inputValues = {
    left: integerDraftNumber(outerDrafts.left),
    right: integerDraftNumber(outerDrafts.right),
    top: integerDraftNumber(outerDrafts.top),
    bottom: integerDraftNumber(outerDrafts.bottom),
  };
  const candidate: ProjectGuideSettings = {
    ...currentSettings(),
    outerLeft: guideCoordinateFromInput(
      "left",
      inputValues.left,
      props.pageSize,
      projectStore.guideSettings.inputMode,
    ),
    outerRight: guideCoordinateFromInput(
      "right",
      inputValues.right,
      props.pageSize,
      projectStore.guideSettings.inputMode,
    ),
    outerTop: guideCoordinateFromInput(
      "top",
      inputValues.top,
      props.pageSize,
      projectStore.guideSettings.inputMode,
    ),
    outerBottom: guideCoordinateFromInput(
      "bottom",
      inputValues.bottom,
      props.pageSize,
      projectStore.guideSettings.inputMode,
    ),
  };
  if (usesEdgeInsets.value) {
    projectStore.setGuideSettings(candidate);
    localError.value = "";
    session.markDirty();
    return;
  }
  try {
    const layout = layoutStore.layout;
    if (!layout) return;
    resolveGuideGeometry(
      { ...candidate, mode: "none" },
      detectedGuideCoordinates(documentStore.guideDetection),
      props.pageSize,
      layout,
    );
    projectStore.setGuideSettings(candidate);
    localError.value = "";
    session.markDirty();
  } catch (error) {
    localError.value = error instanceof Error ? error.message : "外边界无效。";
  }
}

function setOutputOption(key: keyof ProjectOutputSettings, checked: boolean) {
  projectStore.setOutputSettings({ ...projectStore.outputSettings, [key]: checked });
  session.markDirty();
}

function setRemoveGuides(removeGuides: boolean) {
  projectStore.setOutputSettings({
    ...projectStore.outputSettings,
    keepGuides: !removeGuides,
  });
  session.markDirty();
}

watch(
  () => [guideStore.lines, projectStore.guideSettings.inputMode, props.pageSize] as const,
  ([lines]) => {
    for (const direction of GUIDE_DIRECTIONS) {
      const line = lines[direction];
      seamDrafts[direction] = line
        ? formatUiNumber(guideInputValueFromCoordinate(
            direction,
            line.coordinatePt,
            props.pageSize,
            projectStore.guideSettings.inputMode,
          ))
        : "";
    }
  },
  { deep: true, immediate: true },
);

watch(
  () => projectStore.guideSettings,
  (value) => {
    outerDrafts.left = String(Math.round(guideInputValueFromCoordinate(
      "left",
      value.outerLeft,
      props.pageSize,
      value.inputMode,
    )));
    outerDrafts.right = String(Math.round(guideInputValueFromCoordinate(
      "right",
      value.outerRight ?? props.pageSize.width,
      props.pageSize,
      value.inputMode,
    )));
    outerDrafts.top = String(Math.round(guideInputValueFromCoordinate(
      "top",
      value.outerTop,
      props.pageSize,
      value.inputMode,
    )));
    outerDrafts.bottom = String(Math.round(guideInputValueFromCoordinate(
      "bottom",
      value.outerBottom ?? props.pageSize.height,
      props.pageSize,
      value.inputMode,
    )));
    detectionDrafts.dpi = formatUiNumber(value.detection.dpi);
    detectionDrafts.redMin = formatUiNumber(value.detection.redMin);
    detectionDrafts.otherMax = formatUiNumber(value.detection.otherMax);
    detectionDrafts.redDelta = formatUiNumber(value.detection.redDelta);
    detectionDrafts.minimumFraction = formatUiNumber(value.detection.minimumFraction);
  },
  { deep: true, immediate: true },
);
</script>

<template>
  <aside class="advanced-inspector" aria-label="高级接缝和导出设置">
    <section class="inspector-section">
      <div class="inspector-heading-row">
        <span class="eyebrow">接缝裁切</span>
        <label class="check-row">
          <Checkbox
            aria-label="裁切页间接缝"
            :model-value="projectStore.guideSettings.mode !== 'none'"
            :disabled="documentStore.detectionStatus === 'running'"
            @update:model-value="setSeamCropping(Boolean($event))"
          />
          应用
        </label>
      </div>

      <label class="stitching-mode-field">
        <span>拼接模式</span>
        <NativeSelect
          aria-label="拼接模式"
          class="w-full"
          :model-value="selectedStitchingMode"
          :disabled="documentStore.detectionStatus === 'running'"
          @update:model-value="setStitchingMode"
        >
          <NativeSelectOption value="auto">自动识别</NativeSelectOption>
          <NativeSelectOption value="red-guides">辅助线拼接</NativeSelectOption>
          <NativeSelectOption value="content-overlap">内容匹配</NativeSelectOption>
        </NativeSelect>
        <small v-if="selectedStitchingMode === 'auto' && detectedStitchingModeText">
          自动识别结果：{{ detectedStitchingModeText }}
        </small>
      </label>

      <Alert v-if="projectStore.guideSettings.mode === 'none'" class="guide-success">
        <AlertDescription>未裁切页间接缝，仅应用外边界。</AlertDescription>
      </Alert>
      <Alert
        v-else-if="documentStore.guideDetection?.contentOverlap?.applied"
        class="guide-success"
        role="status"
      >
        <AlertDescription>已按页面重复内容自动拼接<span
          v-if="documentStore.guideDetection.contentOverlap.rasterDpi && documentStore.guideDetection.contentOverlap.rasterDpi !== projectStore.guideSettings.detection.dpi"
        >（已自动改用 {{ documentStore.guideDetection.contentOverlap.rasterDpi }} DPI）</span>，可继续调整四边裁切量。</AlertDescription>
      </Alert>
      <Alert v-else-if="guideStore.missing.length" class="guide-warning" role="status">
        <AlertDescription>{{ usesEdgeInsets ? `内容匹配置信度不足；缺少${missingGuideText}方向裁切量，可直接填写。` : `缺少${missingGuideText}方向辅助线，可直接填写或重新检测。` }}</AlertDescription>
      </Alert>
      <Alert v-else-if="hasManualGuides" class="guide-success" role="status">
        <AlertDescription>拼接线已微调，可继续编辑或重新检测。</AlertDescription>
      </Alert>
      <Alert v-else class="guide-success" role="status">
        <AlertDescription>四条拼接线已检测，可直接微调。</AlertDescription>
      </Alert>

      <div class="inspector-grid inspector-grid--two">
        <label v-for="direction in GUIDE_DIRECTIONS" :key="direction">
          <span>{{ seamFieldLabel(direction) }}</span>
          <Input
            v-model="seamDrafts[direction]"
            type="number"
            :min="usesEdgeInsets ? undefined : 0"
            step="0.001"
            :aria-label="`${guideLabels[direction]}拼接线 point 坐标`"
            :disabled="projectStore.guideSettings.mode === 'none'"
            @change="applyManualGuide(direction)"
            @keydown.enter="applyManualGuide(direction)"
          />
          <small :class="`source-${guideStore.lines[direction]?.source ?? 'missing'}`">
            {{ guideStore.lines[direction]?.source === 'auto' ? '检测值' : guideStore.lines[direction]?.source === 'manual' ? '已调整' : '缺失' }}
          </small>
        </label>
      </div>
      <label v-if="usesEdgeInsets" class="check-row">
        <Checkbox
          :model-value="syncSeamInsets"
          aria-label="同步修改四个方向裁切量"
          @update:model-value="syncSeamInsets = Boolean($event)"
        />
        同步修改四个方向
      </label>
    </section>

    <section class="inspector-section">
      <span class="eyebrow">{{ usesEdgeInsets ? '外边界裁切量 · 整数 pt' : '外边界 · 整数 pt' }}</span>
      <div class="inspector-grid inspector-grid--two">
        <label v-for="entry in ([['left', '左'], ['right', '右'], ['top', '上'], ['bottom', '下']] as const)" :key="entry[0]">
          <span>{{ entry[1] }}</span>
          <Input
            v-model="outerDrafts[entry[0]]"
            type="number"
            :min="usesEdgeInsets ? undefined : 0"
            step="1"
            :aria-label="`${entry[1]}外边界 point 坐标`"
            @change="applyOuterBoundaries"
            @keydown.enter="applyOuterBoundaries"
          />
        </label>
      </div>
    </section>

    <section class="inspector-section">
      <div class="inspector-heading-row">
        <span class="eyebrow">检测参数</span>
        <Button
          variant="outline"
          @click="handleDetectionAction"
        >
          {{ documentStore.detectionStatus === 'running' ? '取消识别' : '重新识别' }}
        </Button>
      </div>
      <small v-if="documentStore.detectionStatus === 'running'" class="task-progress-text">
        {{ detectionPhaseText }} ·
        {{ documentStore.detectionProgress.completed }}/{{ documentStore.detectionProgress.total || '…' }} 页
      </small>
      <div class="inspector-grid inspector-grid--two">
        <label v-for="entry in ([['dpi', 'DPI'], ['redMin', '红色下限'], ['otherMax', '绿蓝上限'], ['redDelta', '红色差值'], ['minimumFraction', '最小跨度']] as const)" :key="entry[0]">
          <span>{{ entry[1] }}</span>
          <Input
            v-model="detectionDrafts[entry[0]]"
            type="number"
            min="0"
            :max="entry[0] === 'minimumFraction' ? 1 : undefined"
            :step="entry[0] === 'minimumFraction' ? 0.01 : 1"
            :aria-label="entry[1]"
            @change="redetect"
          />
        </label>
      </div>
    </section>

    <section class="inspector-section">
      <span class="eyebrow">导出</span>
      <Badge variant="secondary" class="output-size" aria-label="成品尺寸">{{ outputSizeText }}</Badge>
      <Separator />
      <label class="check-row">
        <Checkbox
          aria-label="删除辅助线"
          :model-value="!projectStore.outputSettings.keepGuides"
          @update:model-value="setRemoveGuides(Boolean($event))"
        />
        删除辅助线
      </label>
      <label class="check-row">
        <Checkbox
          aria-label="保留白色背景"
          :model-value="projectStore.outputSettings.keepBackground"
          @update:model-value="setOutputOption('keepBackground', Boolean($event))"
        />
        保留白色背景
      </label>
      <label class="check-row">
        <Checkbox
          aria-label="允许未使用 PDF 页"
          :model-value="projectStore.outputSettings.allowUnusedPages"
          @update:model-value="setOutputOption('allowUnusedPages', Boolean($event))"
        />
        允许未使用 PDF 页
      </label>
    </section>

    <Alert v-if="displayedError" variant="destructive" role="alert">
      <AlertDescription>{{ displayedError }}</AlertDescription>
    </Alert>
  </aside>
</template>
