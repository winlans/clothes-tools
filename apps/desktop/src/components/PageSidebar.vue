<script setup lang="ts">
import type { PdfPageInfo } from "@pdf2plt/core";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { PreviewState } from "../stores/pdf-document";

const props = defineProps<{
  pages: PdfPageInfo[];
  previews: Record<number, PreviewState>;
}>();
const emit = defineEmits<{
  spacerDragStart: [event: DragEvent];
  visiblePages: [pageNumbers: number[]];
}>();
const root = ref<HTMLElement>();
const visible = new Set<number>();
let observer: IntersectionObserver | undefined;

async function observePages() {
  await nextTick();
  observer?.disconnect();
  visible.clear();
  if (!root.value || typeof IntersectionObserver === "undefined") {
    emit("visiblePages", props.pages.slice(0, 3).map((page) => page.pageNumber));
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);
        if (entry.isIntersecting) visible.add(pageNumber);
        else visible.delete(pageNumber);
      }
      emit("visiblePages", [...visible].sort((a, b) => a - b));
    },
    { root: root.value, rootMargin: "180px 0px", threshold: 0.01 },
  );
  for (const element of root.value.querySelectorAll<HTMLElement>("[data-page-number]")) {
    observer.observe(element);
  }
}

onMounted(observePages);
watch(() => props.pages, observePages);
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <aside ref="root" class="page-sidebar" aria-label="PDF 页码列表">
    <span class="eyebrow">页面</span>
    <button
      type="button"
      class="spacer-tool"
      draggable="true"
      title="拖到画板格子中插入空白占位"
      @dragstart="emit('spacerDragStart', $event)"
    >
      <span class="spacer-tool__mark">＋</span>
      拖入空白块
    </button>
    <article
      v-for="page in props.pages"
      :key="page.pageNumber"
      class="page-thumbnail"
      :data-page-number="page.pageNumber"
    >
      <div class="page-thumbnail__image">
        <img
          v-if="props.previews[page.pageNumber]"
          :src="props.previews[page.pageNumber]?.url"
          :alt="`第 ${page.pageNumber} 页缩略图`"
        />
        <span v-else>…</span>
      </div>
      <span>第 {{ page.pageNumber }} 页</span>
    </article>
  </aside>
</template>
