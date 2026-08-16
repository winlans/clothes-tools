<script setup lang="ts">
import type { PdfPageInfo } from "@pdf2plt/core";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { PreviewState } from "../stores/pdf-document";
import IconButton from "./IconButton.vue";
import { Button } from "./ui/button";

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
const scrollRoot = ref<HTMLElement>();
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
  if (!scrollRoot.value || typeof IntersectionObserver === "undefined") {
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
    { root: scrollRoot.value, rootMargin: "180px 0px", threshold: 0.01 },
  );
  for (const element of scrollRoot.value.querySelectorAll<HTMLElement>("[data-page-number]")) {
    observer.observe(element);
  }
}

onMounted(observePages);
watch([() => props.pages, () => props.collapsed], observePages);
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <aside
    class="page-sidebar"
    :class="{ 'page-sidebar--collapsed': props.collapsed }"
    aria-label="PDF 页码列表"
  >
    <IconButton
      v-if="props.collapsed"
      variant="outline"
      size="icon-lg"
      class="page-sidebar__toggle"
      tooltip="展开页面栏"
      @click="emit('toggle')"
    >›</IconButton>
    <template v-else>
      <div class="page-sidebar__header">
        <span class="eyebrow">页面</span>
        <IconButton
          variant="outline"
          size="icon-lg"
          class="page-sidebar__toggle"
          tooltip="收起页面栏"
          @click="emit('toggle')"
        >‹</IconButton>
      </div>
      <div ref="scrollRoot" class="page-sidebar__content">
        <Button
          variant="outline"
          class="spacer-tool"
          draggable="true"
          title="拖到画板格子中插入空白占位"
          @dragstart="emit('spacerDragStart', $event)"
        >
          <span class="spacer-tool__mark">＋</span>
          拖入空白块
        </Button>
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
              draggable="false"
            />
            <span v-else>…</span>
          </div>
          <span>第 {{ page.pageNumber }} 页</span>
        </article>
      </div>
    </template>
  </aside>
</template>
