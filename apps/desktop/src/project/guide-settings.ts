import {
  GUIDE_DIRECTIONS,
  type DetectedGuideCoordinates,
  type GuideDetectionResult,
  type GuideDirection,
  type GuideLine,
  type PageSizePt,
  type ProjectGuideSettings,
} from "@pdf2plt/core";

const seamKeys: Record<GuideDirection, keyof ProjectGuideSettings> = {
  left: "seamLeft",
  right: "seamRight",
  top: "seamTop",
  bottom: "seamBottom",
};

function directionLimit(direction: GuideDirection, pageSize: PageSizePt): number {
  return direction === "left" || direction === "right" ? pageSize.width : pageSize.height;
}

export function guideInputValueFromCoordinate(
  direction: GuideDirection,
  coordinatePt: number,
  pageSize: PageSizePt,
  inputMode: ProjectGuideSettings["inputMode"],
): number {
  if (inputMode !== "edge-insets" || direction === "left" || direction === "top") {
    return coordinatePt;
  }
  return directionLimit(direction, pageSize) - coordinatePt;
}

export function guideCoordinateFromInput(
  direction: GuideDirection,
  inputValuePt: number,
  pageSize: PageSizePt,
  inputMode: ProjectGuideSettings["inputMode"],
): number {
  if (inputMode !== "edge-insets" || direction === "left" || direction === "top") {
    return inputValuePt;
  }
  return directionLimit(direction, pageSize) - inputValuePt;
}

export function guideSettingsFromLines(
  base: ProjectGuideSettings,
  lines: Partial<Record<GuideDirection, GuideLine>>,
): ProjectGuideSettings {
  const settings = { ...base, detection: { ...base.detection } };
  for (const direction of GUIDE_DIRECTIONS) {
    const key = seamKeys[direction];
    delete settings[key];
    const line = lines[direction];
    if (line) Object.assign(settings, { [key]: line.coordinatePt });
  }
  return settings;
}

export function detectedGuideCoordinates(
  result: GuideDetectionResult | undefined,
): DetectedGuideCoordinates {
  if (!result) return {};
  return Object.fromEntries(
    GUIDE_DIRECTIONS.flatMap((direction) => {
      const line = result.lines[direction];
      return line ? [[direction, line.coordinatePt] as const] : [];
    }),
  );
}
