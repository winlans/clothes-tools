<script setup lang="ts">
import {
  MAX_PREVIEW_LINE_WEIGHT,
  MIN_PREVIEW_LINE_WEIGHT,
  usePreviewAppearanceStore,
} from "../stores/preview-appearance";
import { formatUiNumber } from "../numbers";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";

const appearance = usePreviewAppearanceStore();

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
</script>

<template>
  <div class="preview-appearance-control" aria-label="全局预览样式">
    <label class="preview-color-control">
      <span>前景色</span>
      <input
        type="color"
        aria-label="预览前景色"
        :value="appearance.foregroundColor"
        @input="appearance.setForegroundColor(inputValue($event))"
      />
    </label>
    <label class="preview-color-control">
      <span>背景色</span>
      <input
        type="color"
        aria-label="预览背景色"
        :value="appearance.backgroundColor"
        @input="appearance.setBackgroundColor(inputValue($event))"
      />
    </label>
    <label class="preview-line-weight-control">
      <span>线条粗细</span>
      <Slider
        :min="MIN_PREVIEW_LINE_WEIGHT"
        :max="MAX_PREVIEW_LINE_WEIGHT"
        :step="0.1"
        aria-label="预览线条粗细"
        :model-value="[appearance.lineWeight]"
        @update:model-value="appearance.setLineWeight($event?.[0] ?? appearance.lineWeight)"
      />
      <output>{{ formatUiNumber(appearance.lineWeight) }}×</output>
    </label>
    <Button
      variant="outline"
      :disabled="appearance.isDefault"
      @click="appearance.reset"
    >
      重置默认值
    </Button>
  </div>
</template>
