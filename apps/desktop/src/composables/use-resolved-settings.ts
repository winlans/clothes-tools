import {
  getUnusedLayoutPages,
  resolveGuideGeometry,
  type PageSizePt,
} from "@pdf2plt/core";
import { computed, toValue, type MaybeRefOrGetter } from "vue";

import { detectedGuideCoordinates, guideSettingsFromLines } from "../project/guide-settings";
import { useGuideStore } from "../stores/guides";
import { useLayoutStore } from "../stores/layout";
import { usePdfDocumentStore } from "../stores/pdf-document";
import { useProjectStore } from "../stores/project";

export function useResolvedSettings(
  pageSizeSource: MaybeRefOrGetter<PageSizePt | undefined>,
) {
  const documentStore = usePdfDocumentStore();
  const layoutStore = useLayoutStore();
  const guideStore = useGuideStore();
  const projectStore = useProjectStore();

  const effectiveGuideSettings = computed(() =>
    guideSettingsFromLines(projectStore.guideSettings, guideStore.lines),
  );
  const resolved = computed(() => {
    const pageSize = toValue(pageSizeSource);
    const layout = layoutStore.layout;
    if (!pageSize || !layout) return { value: undefined, error: "请先打开 PDF。" };
    try {
      return {
        value: resolveGuideGeometry(
          effectiveGuideSettings.value,
          detectedGuideCoordinates(documentStore.guideDetection),
          pageSize,
          layout,
        ),
        error: "",
      };
    } catch (error) {
      return {
        value: undefined,
        error: error instanceof Error ? error.message : "接缝或边界设置无效。",
      };
    }
  });
  const unusedPages = computed(() => {
    const layout = layoutStore.layout;
    const pageCount = documentStore.info?.pageCount ?? layoutStore.pageCount;
    return layout && pageCount ? getUnusedLayoutPages(layout, pageCount) : [];
  });
  const unusedPagesError = computed(() =>
    unusedPages.value.length > 0 && !projectStore.outputSettings.allowUnusedPages
      ? `布局仍有未使用页：${unusedPages.value.join("、")}。`
      : "",
  );
  const validationError = computed(() => resolved.value.error || unusedPagesError.value);
  const canExport = computed(() => Boolean(resolved.value.value) && !unusedPagesError.value);

  return {
    effectiveGuideSettings,
    resolved,
    unusedPages,
    validationError,
    canExport,
  };
}
