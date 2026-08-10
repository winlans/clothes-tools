<script setup lang="ts">
import { ref, watch } from "vue";

import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from "../canvas/camera";
import { formatUiNumber, roundUiNumber } from "../numbers";

const props = defineProps<{
  scale: number;
}>();

const emit = defineEmits<{
  setZoom: [scale: number];
}>();

const draftPercent = ref(formatPercent(props.scale));
const invalid = ref(false);

function formatPercent(scale: number): string {
  return formatUiNumber(scale * 100);
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

function commitDraft() {
  const percent = parsePercent(draftPercent.value);
  if (percent === undefined) {
    invalid.value = true;
    return;
  }
  invalid.value = false;
  const roundedPercent = roundUiNumber(percent);
  draftPercent.value = formatUiNumber(roundedPercent);
  emit("setZoom", roundedPercent / 100);
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
  draftPercent.value = formatUiNumber(next);
  commitDraft();
}

watch(
  () => props.scale,
  (scale) => {
    if (!invalid.value) draftPercent.value = formatPercent(scale);
  },
);
</script>

<template>
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
        :title="invalid ? '请输入 10% 至 400% 之间的数字' : '最多保留 3 位小数，例如 37.125'"
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
  </div>
</template>
