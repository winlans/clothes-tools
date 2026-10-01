<script setup lang="ts">
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "@lucide/vue";
import { useWindowControls } from "../composables/use-window-controls";

defineProps<{ closeDisabled?: boolean }>();
const { desktop, isMaximized, error, minimize, toggleMaximize, close, startDragging } = useWindowControls();

function handleMouseDown(event: MouseEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
  // Use one native drag path. The second press handles double-click even when
  // the OS consumed the first release while moving the frameless window.
  if (event.detail === 2) void toggleMaximize();
  else void startDragging();
}
</script>

<template>
  <header class="app-window-titlebar" @mousedown="handleMouseDown">
    <strong class="app-window-titlebar__brand">clothes-tools</strong>
    <span class="app-window-titlebar__caption">PDF 版图排版与矢量导出</span>
    <span v-if="error" class="app-window-titlebar__error" role="alert">{{ error }}</span>
    <div v-if="desktop" class="app-window-controls" aria-label="窗口控制" @mousedown.stop @dblclick.stop>
      <button type="button" class="app-window-control" aria-label="最小化" title="最小化" @click="minimize">
        <MinusIcon />
      </button>
      <button type="button" class="app-window-control" :aria-label="isMaximized ? '还原窗口' : '最大化'" :title="isMaximized ? '还原窗口' : '最大化'" @click="toggleMaximize">
        <CopyIcon v-if="isMaximized" />
        <SquareIcon v-else />
      </button>
      <button type="button" class="app-window-control app-window-control--close" aria-label="关闭" title="关闭" :disabled="closeDisabled" @click="close">
        <XIcon />
      </button>
    </div>
  </header>
</template>
