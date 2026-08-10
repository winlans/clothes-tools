import {
  GUIDE_DIRECTIONS,
  type GuideCoordinates,
  type GuideDetectionResult,
  type GuideDirection,
  type GuideLine,
  type PageSizePt,
  type ProjectGuideSettings,
} from "@pdf2plt/core";
import { defineStore } from "pinia";

export type GuidePreviewMode = "full" | "cropped";

export const useGuideStore = defineStore("guides", {
  state: () => ({
    documentId: "",
    lines: {} as Partial<Record<GuideDirection, GuideLine>>,
    missing: [...GUIDE_DIRECTIONS] as GuideDirection[],
    previewMode: "cropped" as GuidePreviewMode,
    errorMessage: "",
  }),
  getters: {
    coordinates(state): GuideCoordinates | undefined {
      const { left, right, top, bottom } = state.lines;
      if (!left || !right || !top || !bottom) return undefined;
      return {
        left: left.coordinatePt,
        right: right.coordinatePt,
        top: top.coordinatePt,
        bottom: bottom.coordinatePt,
      };
    },
    canPreviewCropped(): boolean {
      const coordinates = this.coordinates;
      return Boolean(
        coordinates &&
          coordinates.left < coordinates.right &&
          coordinates.top < coordinates.bottom,
      );
    },
  },
  actions: {
    initialize(documentId: string) {
      if (this.documentId === documentId) return;
      this.documentId = documentId;
      this.lines = {};
      this.missing = [...GUIDE_DIRECTIONS];
      this.previewMode = "cropped";
      this.errorMessage = "";
    },
    applyDetection(documentId: string, result: GuideDetectionResult) {
      if (this.documentId !== documentId) this.initialize(documentId);
      this.lines = { ...result.lines };
      this.missing = [...result.missing];
      this.previewMode = "cropped";
      this.errorMessage = "";
    },
    restore(documentId: string, settings: ProjectGuideSettings) {
      this.documentId = documentId;
      const source = settings.mode === "manual" ? "manual" : "auto";
      this.lines = {};
      for (const [direction, coordinatePt] of [
        ["left", settings.seamLeft],
        ["right", settings.seamRight],
        ["top", settings.seamTop],
        ["bottom", settings.seamBottom],
      ] as const) {
        if (coordinatePt !== undefined) {
          this.lines[direction] = { coordinatePt, source, supportPages: 0, pixelWeight: 0 };
        }
      }
      this.missing = GUIDE_DIRECTIONS.filter((direction) => !this.lines[direction]);
      this.previewMode = this.missing.length === 0 && settings.mode !== "none" ? "cropped" : "full";
      this.errorMessage = "";
    },
    setManual(direction: GuideDirection, coordinatePt: number, pageSize: PageSizePt) {
      const limit = direction === "left" || direction === "right" ? pageSize.width : pageSize.height;
      if (!Number.isFinite(coordinatePt) || coordinatePt < 0 || coordinatePt > limit) {
        this.errorMessage = `${direction} 坐标必须在 0..${limit.toFixed(3)} pt 范围内。`;
        return false;
      }
      const previous = this.lines[direction];
      this.lines[direction] = {
        coordinatePt,
        source: "manual",
        supportPages: 0,
        pixelWeight: 0,
      };
      this.missing = GUIDE_DIRECTIONS.filter((name) => !this.lines[name]);
      if (this.coordinates && !this.canPreviewCropped) {
        if (previous) this.lines[direction] = previous;
        else delete this.lines[direction];
        this.missing = GUIDE_DIRECTIONS.filter((name) => !this.lines[name]);
        this.errorMessage = "左线必须小于右线，上线必须小于下线。";
        return false;
      }
      this.errorMessage = "";
      return true;
    },
    setPreviewMode(mode: GuidePreviewMode) {
      if (mode === "cropped" && !this.canPreviewCropped) {
        this.errorMessage = "请先补齐有效的左、右、上、下拼接线。";
        return false;
      }
      this.previewMode = mode;
      this.errorMessage = "";
      return true;
    },
    setPreviewModeValidated(mode: GuidePreviewMode, canCrop: boolean) {
      if (mode === "cropped" && !canCrop) {
        this.errorMessage = "当前接缝或外边界不能形成有效的成品预览。";
        return false;
      }
      this.previewMode = mode;
      this.errorMessage = "";
      return true;
    },
    clear() {
      this.documentId = "";
      this.lines = {};
      this.missing = [...GUIDE_DIRECTIONS];
      this.previewMode = "cropped";
      this.errorMessage = "";
    },
  },
});
