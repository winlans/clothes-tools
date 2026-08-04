<script setup lang="ts">
import {
  GUIDE_DIRECTIONS,
  resolveGuideDetectionOptions,
  resolveGuideGeometry,
  type GuideDirection,
  type GuideMode,
  type PageSizePt,
  type ProjectGuideSettings,
  type ProjectOutputSettings,
} from "@pdf2plt/core";
import { computed, reactive, ref, watch } from "vue";

import { useResolvedSettings } from "../composables/use-resolved-settings";
import { detectedGuideCoordinates, guideSettingsFromLines } from "../project/guide-settings";
import { useGuideStore } from "../stores/guides";
import { useLayoutStore } from "../stores/layout";
import { usePdfDocumentStore } from "../stores/pdf-document";
import { useProjectStore } from "../stores/project";

const props = defineProps<{ pageSize: PageSizePt }>();
const documentStore = usePdfDocumentStore();
const layoutStore = useLayoutStore();
const guideStore = useGuideStore();
const projectStore = useProjectStore();
const settings = useResolvedSettings(() => props.pageSize);
const localError = ref("");

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
const outputSizeText = computed(() => {
  const geometry = settings.resolved.value.value?.geometry;
  if (!geometry) return "设置无效";
  return `${((geometry.width * 25.4) / 72).toFixed(2)} × ${((geometry.height * 25.4) / 72).toFixed(2)} mm`;
});
const displayedError = computed(() =>
  localError.value || documentStore.detectionErrorMessage || settings.validationError.value,
);

function currentSettings(mode = projectStore.guideSettings.mode): ProjectGuideSettings {
  return {
    ...guideSettingsFromLines(projectStore.guideSettings, guideStore.lines),
    mode,
  };
}

async function redetect() {
  try {
    const options = resolveGuideDetectionOptions({
      dpi: Number(detectionDrafts.dpi),
      redMin: Number(detectionDrafts.redMin),
      otherMax: Number(detectionDrafts.otherMax),
      redDelta: Number(detectionDrafts.redDelta),
      minimumFraction: Number(detectionDrafts.minimumFraction),
    });
    projectStore.setGuideSettings({
      ...currentSettings("auto"),
      detection: options,
    });
    const result = await documentStore.detectGuides(options);
    guideStore.applyDetection(documentStore.info?.documentId ?? "", result);
    projectStore.setGuideSettings({
      ...guideSettingsFromLines(projectStore.guideSettings, guideStore.lines),
      mode: "auto",
    });
    localError.value = "";
    guideStore.setPreviewModeValidated("cropped", Boolean(settings.resolved.value.value));
  } catch (error) {
    localError.value = error instanceof Error ? error.message : "红线检测失败。";
  }
}

async function setMode(mode: GuideMode) {
  localError.value = "";
  if (mode === "auto") {
    await redetect();
    return;
  }
  if (mode === "manual") guideStore.markLinesManual();
  projectStore.setGuideSettings(currentSettings(mode));
  guideStore.setPreviewModeValidated("cropped", Boolean(settings.resolved.value.value));
}

function applyManualGuide(direction: GuideDirection) {
  if (projectStore.guideSettings.mode !== "manual") {
    guideStore.markLinesManual();
    projectStore.setGuideSettings(currentSettings("manual"));
  }
  if (guideStore.setManual(direction, Number(seamDrafts[direction]), props.pageSize)) {
    projectStore.setGuideSettings(currentSettings("manual"));
    localError.value = "";
  }
}

function applyOuterBoundaries() {
  const candidate: ProjectGuideSettings = {
    ...currentSettings(),
    outerLeft: Number(outerDrafts.left),
    outerRight: Number(outerDrafts.right),
    outerTop: Number(outerDrafts.top),
    outerBottom: Number(outerDrafts.bottom),
  };
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
  } catch (error) {
    localError.value = error instanceof Error ? error.message : "外边界无效。";
  }
}

function setOutputOption(key: keyof ProjectOutputSettings, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  projectStore.setOutputSettings({ ...projectStore.outputSettings, [key]: checked });
}

watch(
  () => guideStore.lines,
  (lines) => {
    for (const direction of GUIDE_DIRECTIONS) {
      const line = lines[direction];
      seamDrafts[direction] = line ? line.coordinatePt.toFixed(3) : "";
    }
  },
  { deep: true, immediate: true },
);

watch(
  () => projectStore.guideSettings,
  (value) => {
    outerDrafts.left = String(value.outerLeft);
    outerDrafts.right = String(value.outerRight ?? props.pageSize.width);
    outerDrafts.top = String(value.outerTop);
    outerDrafts.bottom = String(value.outerBottom ?? props.pageSize.height);
    detectionDrafts.dpi = String(value.detection.dpi);
    detectionDrafts.redMin = String(value.detection.redMin);
    detectionDrafts.otherMax = String(value.detection.otherMax);
    detectionDrafts.redDelta = String(value.detection.redDelta);
    detectionDrafts.minimumFraction = String(value.detection.minimumFraction);
  },
  { deep: true, immediate: true },
);
</script>

<template>
  <aside class="advanced-inspector" aria-label="高级接缝和导出设置">
    <section class="inspector-section">
      <span class="eyebrow">接缝模式</span>
      <div class="mode-switch mode-switch--wide" role="group" aria-label="接缝模式">
        <button
          v-for="entry in ([['auto', '自动'], ['manual', '手动'], ['none', '无接缝']] as const)"
          :key="entry[0]"
          type="button"
          :class="{ active: projectStore.guideSettings.mode === entry[0] }"
          :aria-pressed="projectStore.guideSettings.mode === entry[0]"
          :disabled="documentStore.detectionStatus === 'running'"
          @click="setMode(entry[0])"
        >
          {{ entry[1] }}
        </button>
      </div>

      <p v-if="projectStore.guideSettings.mode === 'none'" class="guide-success">
        不裁切页间接缝，仅应用外边界。
      </p>
      <p v-else-if="guideStore.missing.length" class="guide-warning" role="status">
        缺少{{ missingGuideText }}方向红线，可切换手动模式填写。
      </p>
      <p v-else class="guide-success" role="status">四条拼接线有效。</p>

      <div class="inspector-grid inspector-grid--two">
        <label v-for="direction in GUIDE_DIRECTIONS" :key="direction">
          <span>{{ guideLabels[direction] }}拼接线</span>
          <input
            v-model="seamDrafts[direction]"
            type="number"
            min="0"
            step="0.001"
            :aria-label="`${guideLabels[direction]}拼接线 point 坐标`"
            @change="applyManualGuide(direction)"
            @keydown.enter="applyManualGuide(direction)"
          />
          <small :class="`source-${guideStore.lines[direction]?.source ?? 'missing'}`">
            {{ guideStore.lines[direction]?.source === 'auto' ? '自动' : guideStore.lines[direction]?.source === 'manual' ? '手动' : '缺失' }}
          </small>
        </label>
      </div>
    </section>

    <section class="inspector-section">
      <span class="eyebrow">外边界 · pt</span>
      <div class="inspector-grid inspector-grid--two">
        <label v-for="entry in ([['left', '左'], ['right', '右'], ['top', '上'], ['bottom', '下']] as const)" :key="entry[0]">
          <span>{{ entry[1] }}</span>
          <input
            v-model="outerDrafts[entry[0]]"
            type="number"
            min="0"
            step="0.001"
            :aria-label="`${entry[1]}外边界 point 坐标`"
            @change="applyOuterBoundaries"
            @keydown.enter="applyOuterBoundaries"
          />
        </label>
      </div>
    </section>

    <section class="inspector-section">
      <div class="inspector-heading-row">
        <span class="eyebrow">红线阈值</span>
        <button
          type="button"
          class="compact-button"
          :disabled="documentStore.detectionStatus === 'running'"
          @click="redetect"
        >
          {{ documentStore.detectionStatus === 'running' ? '检测中…' : '重新检测' }}
        </button>
      </div>
      <div class="inspector-grid inspector-grid--two">
        <label v-for="entry in ([['dpi', 'DPI'], ['redMin', '红色下限'], ['otherMax', '绿蓝上限'], ['redDelta', '红色差值'], ['minimumFraction', '最小跨度']] as const)" :key="entry[0]">
          <span>{{ entry[1] }}</span>
          <input
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
      <strong class="output-size" aria-label="成品尺寸">{{ outputSizeText }}</strong>
      <label class="check-row">
        <input
          type="checkbox"
          :checked="projectStore.outputSettings.keepGuides"
          @change="setOutputOption('keepGuides', $event)"
        />
        保留红色辅助线
      </label>
      <label class="check-row">
        <input
          type="checkbox"
          :checked="projectStore.outputSettings.keepBackground"
          @change="setOutputOption('keepBackground', $event)"
        />
        保留白色背景
      </label>
      <label class="check-row">
        <input
          type="checkbox"
          :checked="projectStore.outputSettings.allowUnusedPages"
          @change="setOutputOption('allowUnusedPages', $event)"
        />
        允许未使用 PDF 页
      </label>
    </section>

    <p v-if="displayedError" class="inline-error" role="alert">{{ displayedError }}</p>
  </aside>
</template>
