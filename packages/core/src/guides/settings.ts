import type { LayoutGrid } from "../layout/automatic-layout";
import type { PageSizePt } from "../pdf/document";
import { Pdf2PltError } from "../pdf/errors";
import {
  createLayoutCropGeometry,
  type GuideCoordinates,
  type LayoutCropGeometry,
} from "./crop";
import type { GuideDirection } from "./detection";

export type GuideMode = "auto" | "manual" | "none";

export interface GuideCropSettings {
  mode: GuideMode;
  seamLeft?: number;
  seamRight?: number;
  seamTop?: number;
  seamBottom?: number;
  outerLeft: number;
  outerRight?: number;
  outerTop: number;
  outerBottom?: number;
}

export interface ResolvedGuideGeometry {
  coordinates: GuideCoordinates;
  geometry: LayoutCropGeometry;
}

export type DetectedGuideCoordinates = Partial<Record<GuideDirection, number>>;

export function resolveGuideGeometry(
  settings: GuideCropSettings,
  detected: DetectedGuideCoordinates,
  pageSize: PageSizePt,
  layout: LayoutGrid,
): ResolvedGuideGeometry {
  const resolveSeam = (
    direction: GuideDirection,
    configured: number | undefined,
    fallback: number,
    needed: boolean,
  ): number => {
    if (settings.mode === "none") return fallback;
    const value = configured ?? (settings.mode === "auto" ? detected[direction] : undefined);
    if (value !== undefined) return value;
    if (!needed) return fallback;
    const labels: Record<GuideDirection, string> = {
      left: "左",
      right: "右",
      top: "上",
      bottom: "下",
    };
    throw new Pdf2PltError(
      "missing-guide-coordinate",
      `${settings.mode === "auto" ? "自动检测" : "手动模式"}缺少${labels[direction]}拼接线。`,
    );
  };

  const coordinates: GuideCoordinates = {
    left: resolveSeam("left", settings.seamLeft, 0, layout.columns > 1),
    right: resolveSeam("right", settings.seamRight, pageSize.width, layout.columns > 1),
    top: resolveSeam("top", settings.seamTop, 0, layout.rows > 1),
    bottom: resolveSeam("bottom", settings.seamBottom, pageSize.height, layout.rows > 1),
    outerLeft: settings.outerLeft,
    outerRight: settings.outerRight ?? pageSize.width,
    outerTop: settings.outerTop,
    outerBottom: settings.outerBottom ?? pageSize.height,
  };
  return {
    coordinates,
    geometry: createLayoutCropGeometry(layout, pageSize, coordinates),
  };
}
