import {
  getUnusedLayoutPages,
  resolveGuideGeometry,
  type PageSizePt,
} from "@pdf2plt/core";
import { computed, toValue, type MaybeRefOrGetter } from "vue";

import { detectedGuideCoordinates, guideSettingsFromLines } from "../project/guide-settings";
import type { DocumentSession } from "../stores/document-session";
import { useGuideStore } from "../stores/guides";
import { useLayoutStore } from "../stores/layout";
import { usePdfDocumentStore } from "../stores/pdf-document";
import { useProjectStore } from "../stores/project";

export function useResolvedSettings(
  pageSizeSource: MaybeRefOrGetter<PageSizePt | undefined>,
  sessionSource?: MaybeRefOrGetter<DocumentSession | undefined>,
) {
  const fallback = sessionSource
    ? undefined
    : {
        documentStore: usePdfDocumentStore(),
        layoutStore: useLayoutStore(),
        guideStore: useGuideStore(),
        projectStore: useProjectStore(),
      };
  const stores = () => toValue(sessionSource) ?? fallback;

  const effectiveGuideSettings = computed(() =>
    stores()
      ? guideSettingsFromLines(
          stores()!.projectStore.guideSettings,
          stores()!.guideStore.lines,
        )
      : undefined,
  );
  const resolved = computed(() => {
    const pageSize = toValue(pageSizeSource);
    const current = stores();
    const layout = current?.layoutStore.layout;
    if (!pageSize || !layout || !current || !effectiveGuideSettings.value) {
      return { value: undefined, error: "请先打开 PDF。" };
    }
    try {
      return {
        value: resolveGuideGeometry(
          effectiveGuideSettings.value,
          detectedGuideCoordinates(current.documentStore.guideDetection),
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
    const current = stores();
    const layout = current?.layoutStore.layout;
    const pageCount = current?.documentStore.info?.pageCount ?? current?.layoutStore.pageCount;
    return layout && pageCount ? getUnusedLayoutPages(layout, pageCount) : [];
  });
  const unusedPagesError = computed(() =>
    unusedPages.value.length > 0 && !stores()?.projectStore.outputSettings.allowUnusedPages
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
