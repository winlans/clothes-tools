<script setup lang="ts">
import type { ButtonVariants } from "./ui/button";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{
  tooltip: string;
  ariaLabel?: string;
  variant?: ButtonVariants["variant"];
  size?: ButtonVariants["size"];
  disabled?: boolean;
}>(), {
  ariaLabel: undefined,
  variant: "outline",
  size: "icon",
  disabled: false,
});
</script>

<template>
  <TooltipProvider :delay-duration="350">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          v-bind="$attrs"
          :variant="variant"
          :size="size"
          :disabled="disabled"
          :aria-label="ariaLabel ?? tooltip"
          :title="tooltip"
        >
          <slot />
        </Button>
      </TooltipTrigger>
      <TooltipContent class="app-tooltip">{{ tooltip }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
