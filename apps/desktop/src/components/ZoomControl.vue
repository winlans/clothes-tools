<script setup lang="ts">
import { CalculatorIcon, MinusIcon, PlusIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from "../canvas/camera";
import IconButton from "./IconButton.vue";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "./ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const props = defineProps<{
  scale: number;
}>();

const emit = defineEmits<{
  setZoom: [scale: number];
}>();

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

watch(
  () => props.scale,
  (scale) => {
    if (!invalid.value) draftPercent.value = formatPercent(scale);
  },
);
</script>

<template>
  <Popover v-model:open="calculatorOpen">
    <ButtonGroup class="zoom-control" aria-label="缩放百分比">
      <IconButton
        variant="outline"
        size="icon"
        tooltip="缩小 0.1%"
        @click="stepPercent(-0.1)"
      >
        <MinusIcon />
      </IconButton>
      <InputGroup class="zoom-control__input-group">
        <InputGroupInput
          v-model="draftPercent"
          inputmode="decimal"
          aria-label="缩放百分比"
          :aria-invalid="invalid || undefined"
          :title="invalid ? '请输入 10% 至 400% 之间的数字' : '缩放比例保留 2 位小数'"
          @change="commitDraft"
          @keydown.enter.prevent="commitDraft"
          @keydown.escape.prevent="restoreDraft"
          @blur="restoreDraft"
        />
        <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
      </InputGroup>
      <IconButton
        variant="outline"
        size="icon"
        tooltip="放大 0.1%"
        @click="stepPercent(0.1)"
      >
        <PlusIcon />
      </IconButton>
      <PopoverTrigger as-child>
        <IconButton
          variant="outline"
          size="icon"
          class="zoom-control__calculator-button"
          tooltip="自动计算缩放比例"
        >
          <CalculatorIcon />
        </IconButton>
      </PopoverTrigger>
    </ButtonGroup>

    <PopoverContent align="end" class="zoom-calculator">
      <form @submit.prevent="applyCalculatedZoom">
        <div class="zoom-calculator__heading">
          <strong>自动计算缩放比例</strong>
          <span>当前 {{ formatPercent(props.scale) }}%</span>
        </div>

        <div class="zoom-calculator__fields">
          <label>
            <span>校对块尺寸</span>
            <InputGroup>
              <InputGroupInput
                v-model="calibrationSize"
                inputmode="decimal"
                aria-label="校对块尺寸"
                placeholder="0"
              />
              <InputGroupAddon align="inline-end"><InputGroupText>cm</InputGroupText></InputGroupAddon>
            </InputGroup>
          </label>
          <label>
            <span>投放尺寸</span>
            <InputGroup>
              <InputGroupInput
                v-model="placementSize"
                inputmode="decimal"
                aria-label="投放尺寸"
                placeholder="0"
              />
              <InputGroupAddon align="inline-end"><InputGroupText>cm</InputGroupText></InputGroupAddon>
            </InputGroup>
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
          <Button type="button" variant="outline" @click="closeCalculator">取消</Button>
          <Button type="submit" :disabled="!canApplyCalculatedZoom">应用</Button>
        </div>
      </form>
    </PopoverContent>
  </Popover>
</template>
