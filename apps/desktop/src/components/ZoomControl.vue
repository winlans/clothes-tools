<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from "../canvas/camera";

const props = defineProps<{
  scale: number;
}>();

const emit = defineEmits<{
  setZoom: [scale: number];
}>();

const controlRoot = ref<HTMLElement>();
const calibrationInput = ref<HTMLInputElement>();
const draftPercent = ref(formatPercent(props.scale));
const invalid = ref(false);
const calculatorOpen = ref(false);
const calibrationSize = ref("");
const placementSize = ref("");

function formatPercent(scale: number): string {
  return (scale * 100).toFixed(2);
}

function roundPercent(percent: number): number {
  return Number(percent.toFixed(2));
}

function parsePercent(value: string): number | undefined {
  const normalized = value.trim().replace(/%$/, "").replace(",", ".");
  if (!normalized) return undefined;
  const percent = Number(normalized);
  const minimum = MIN_CANVAS_ZOOM * 100;
  const maximum = MAX_CANVAS_ZOOM * 100;
  if (!Number.isFinite(percent) || percent < minimum || percent > maximum) {
    return undefined;
  }
  return percent;
}

function parsePositiveDecimal(value: string): number | undefined {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const targetPercent = computed(() => {
  const calibration = parsePositiveDecimal(calibrationSize.value);
  const placement = parsePositiveDecimal(placementSize.value);
  if (calibration === undefined || placement === undefined) return undefined;

  const target = props.scale * 100 * placement / calibration;
  return Number.isFinite(target) ? roundPercent(target) : undefined;
});

const calculatorError = computed(() => {
  if (!calibrationSize.value && !placementSize.value) return "";
  if (targetPercent.value === undefined) {
    return "请输入大于 0 的校对块尺寸和投放尺寸。";
  }
  const minimum = MIN_CANVAS_ZOOM * 100;
  const maximum = MAX_CANVAS_ZOOM * 100;
  if (targetPercent.value < minimum || targetPercent.value > maximum) {
    return `计算结果需在 ${minimum}% 至 ${maximum}% 之间。`;
  }
  return "";
});

const canApplyCalculatedZoom = computed(() =>
  targetPercent.value !== undefined && calculatorError.value === ""
);

function commitDraft() {
  const percent = parsePercent(draftPercent.value);
  if (percent === undefined) {
    invalid.value = true;
    return;
  }
  invalid.value = false;
  const roundedPercent = roundPercent(percent);
  draftPercent.value = roundedPercent.toFixed(2);
  emit("setZoom", Number((roundedPercent / 100).toFixed(4)));
}

function restoreDraft() {
  if (!invalid.value) return;
  invalid.value = false;
  draftPercent.value = formatPercent(props.scale);
}

function stepPercent(delta: number) {
  const current = parsePercent(draftPercent.value) ?? props.scale * 100;
  const minimum = MIN_CANVAS_ZOOM * 100;
  const maximum = MAX_CANVAS_ZOOM * 100;
  const next = Math.min(maximum, Math.max(minimum, current + delta));
  draftPercent.value = roundPercent(next).toFixed(2);
  commitDraft();
}

function toggleCalculator() {
  calculatorOpen.value = !calculatorOpen.value;
  if (calculatorOpen.value) {
    void nextTick(() => calibrationInput.value?.focus());
  }
}

function closeCalculator() {
  calculatorOpen.value = false;
}

function applyCalculatedZoom() {
  if (!canApplyCalculatedZoom.value || targetPercent.value === undefined) return;
  draftPercent.value = targetPercent.value.toFixed(2);
  invalid.value = false;
  emit("setZoom", Number((targetPercent.value / 100).toFixed(4)));
  closeCalculator();
}

function handleOutsidePointerDown(event: PointerEvent) {
  if (!calculatorOpen.value || !(event.target instanceof Node)) return;
  if (!controlRoot.value?.contains(event.target)) closeCalculator();
}

watch(
  () => props.scale,
  (scale) => {
    if (!invalid.value) draftPercent.value = formatPercent(scale);
  },
);

onMounted(() => document.addEventListener("pointerdown", handleOutsidePointerDown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", handleOutsidePointerDown));
</script>

<template>
  <div ref="controlRoot" class="zoom-control-shell">
    <div class="zoom-control" role="group" aria-label="缩放百分比">
      <button
        type="button"
        aria-label="缩小 0.1%"
        title="缩小 0.1%"
        @click="stepPercent(-0.1)"
      >
        −
      </button>
      <label>
        <span class="visually-hidden">缩放百分比</span>
        <input
          v-model="draftPercent"
          type="text"
          inputmode="decimal"
          aria-label="缩放百分比"
          :aria-invalid="invalid || undefined"
          :title="invalid ? '请输入 10% 至 400% 之间的数字' : '缩放比例保留 2 位小数'"
          @change="commitDraft"
          @keydown.enter.prevent="commitDraft"
          @keydown.escape.prevent="restoreDraft"
          @blur="restoreDraft"
        />
        <span>%</span>
      </label>
      <button
        type="button"
        aria-label="放大 0.1%"
        title="放大 0.1%"
        @click="stepPercent(0.1)"
      >
        ＋
      </button>
      <button
        type="button"
        class="zoom-control__calculator-button"
        aria-label="自动计算缩放比例"
        title="自动计算缩放比例"
        :aria-expanded="calculatorOpen"
        @click="toggleCalculator"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" />
          <path d="M5 4.5h6M5 7.5h1M8 7.5h1M11 7.5h.1M5 10.5h1M8 10.5h1M11 10.5h.1" />
        </svg>
      </button>
    </div>

    <form
      v-if="calculatorOpen"
      class="zoom-calculator"
      role="dialog"
      aria-label="自动计算缩放比例"
      @submit.prevent="applyCalculatedZoom"
      @keydown.escape.stop.prevent="closeCalculator"
    >
      <div class="zoom-calculator__heading">
        <strong>自动计算缩放比例</strong>
        <span>当前 {{ formatPercent(props.scale) }}%</span>
      </div>

      <div class="zoom-calculator__fields">
        <label>
          <span>校对块尺寸</span>
          <span class="zoom-calculator__input">
            <input
              ref="calibrationInput"
              v-model="calibrationSize"
              type="text"
              inputmode="decimal"
              aria-label="校对块尺寸"
              placeholder="0"
            />
            <span>cm</span>
          </span>
        </label>
        <label>
          <span>投放尺寸</span>
          <span class="zoom-calculator__input">
            <input
              v-model="placementSize"
              type="text"
              inputmode="decimal"
              aria-label="投放尺寸"
              placeholder="0"
            />
            <span>cm</span>
          </span>
        </label>
      </div>

      <div class="zoom-calculator__formula">
        目标比例 = 当前比例 × 投放尺寸 ÷ 校对块尺寸
      </div>
      <div
        class="zoom-calculator__result"
        :class="{ 'zoom-calculator__result--error': calculatorError }"
        aria-live="polite"
      >
        <template v-if="calculatorError">{{ calculatorError }}</template>
        <template v-else-if="targetPercent !== undefined">
          目标比例 <strong>{{ targetPercent.toFixed(2) }}%</strong>
        </template>
        <template v-else>输入尺寸后自动计算</template>
      </div>

      <div class="zoom-calculator__actions">
        <button type="button" class="compact-button" @click="closeCalculator">
          取消
        </button>
        <button
          type="submit"
          class="primary-button"
          :disabled="!canApplyCalculatedZoom"
        >
          应用
        </button>
      </div>
    </form>
  </div>
</template>
