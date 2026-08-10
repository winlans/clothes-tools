<script setup lang="ts">
import type { PdfPageInfo } from "@pdf2plt/core";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { PreviewState } from "../stores/pdf-document";

const props = defineProps<{
  collapsed: boolean;
  pages: PdfPageInfo[];
  previews: Record<number, PreviewState>;
}>();
const emit = defineEmits<{
  spacerDragStart: [event: DragEvent];
  toggle: [];
  visiblePages: [pageNumbers: number[]];
}>();
const root = ref<HTMLElement>();
const visible = new Set<number>();
let observer: IntersectionObserver | undefined;

async function observePages() {
  await nextTick();
  observer?.disconnect();
  visible.clear();
  if (props.collapsed) {
    emit("visiblePages", []);
    return;
  }
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
watch([() => props.pages, () => props.collapsed], observePages);
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <aside
    ref="root"
    class="page-sidebar"
    :class="{ 'page-sidebar--collapsed': props.collapsed }"
    aria-label="PDF 页码列表"
  >
    <button
      v-if="props.collapsed"
      type="button"
      class="page-sidebar__toggle"
      aria-label="展开页面栏"
      title="展开页面栏"
      @click="emit('toggle')"
    >
      ›
    </button>
    <template v-else>
      <div class="page-sidebar__header">
        <span class="eyebrow">页面</span>
        <button
          type="button"
          class="page-sidebar__toggle"
          aria-label="收起页面栏"
          title="收起页面栏"
          @click="emit('toggle')"
        >
          ‹
        </button>
      </div>
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
    </template>
  </aside>
</template>
