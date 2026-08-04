import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useLayoutStore } from "../stores/layout";
import { useProjectStore } from "../stores/project";
import { useResolvedSettings } from "./use-resolved-settings";

describe("resolved desktop settings", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("blocks unused pages unless the shared output option explicitly allows them", () => {
    const layoutStore = useLayoutStore();
    const projectStore = useProjectStore();
    layoutStore.initialize("pdf-1", 3);
    layoutStore.layout!.cells[2]![0] = null;
    projectStore.setGuideSettings({
      ...projectStore.guideSettings,
      mode: "none",
    });
    const settings = useResolvedSettings({ width: 200, height: 300 });

    expect(settings.unusedPages.value).toEqual([3]);
    expect(settings.canExport.value).toBe(false);
    expect(settings.validationError.value).toContain("未使用页：3");

    projectStore.setOutputSettings({
      ...projectStore.outputSettings,
      allowUnusedPages: true,
    });
    expect(settings.canExport.value).toBe(true);
  });
});
