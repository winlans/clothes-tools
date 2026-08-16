<script setup lang="ts">
import type { GuideDetectionPhase } from "@pdf2plt/core";
import { LoaderCircleIcon } from "@lucide/vue";
import { computed } from "vue";

import { Card, CardContent } from "./ui/card";
import { Progress } from "./ui/progress";

const props = defineProps<{
  phase: GuideDetectionPhase;
  completed: number;
  total: number;
}>();

const phaseText = computed(() => {
  if (props.phase === "content-overlap") return "正在匹配相邻页面内容";
  if (props.phase === "guide-pattern") return "正在分析跨页拼接模式";
  return "正在扫描页面拼接辅助线";
});

const progressPercent = computed(() => {
  if (props.total <= 0) return 0;
  return Math.min(100, Math.round((props.completed / props.total) * 100));
});
</script>

<template>
  <div
    class="stitching-calculation-overlay"
    role="status"
    aria-live="polite"
    aria-label="图片拼接计算中"
  >
    <Card class="stitching-calculation-card">
      <CardContent class="stitching-calculation-card__content">
        <LoaderCircleIcon class="stitching-calculation-card__spinner" aria-hidden="true" />
        <div class="stitching-calculation-card__message">
          <strong>正在计算图片拼接</strong>
          <span>{{ phaseText }}</span>
        </div>
        <Progress
          :model-value="progressPercent"
          :aria-label="total > 0 ? `拼接计算进度 ${completed}/${total}` : '正在准备拼接计算'"
        />
        <small v-if="total > 0">已处理 {{ completed }}/{{ total }} 页</small>
        <small v-else>正在准备页面数据…</small>
      </CardContent>
    </Card>
  </div>
</template>
