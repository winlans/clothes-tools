import { defineStore } from "pinia";

export const MIN_PREVIEW_LINE_WEIGHT = 0.5;
export const MAX_PREVIEW_LINE_WEIGHT = 3;

export interface PreviewAppearance {
  foregroundColor: string;
  backgroundColor: string;
  lineWeight: number;
}

export const DEFAULT_PREVIEW_APPEARANCE: Readonly<PreviewAppearance> = Object.freeze({
  foregroundColor: "#000000",
  backgroundColor: "#ffffff",
  lineWeight: 2,
});

function normalizeColor(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

export function previewInkLayerOpacities(lineWeight: number): number[] {
  const weight = Math.max(
    MIN_PREVIEW_LINE_WEIGHT,
    Math.min(MAX_PREVIEW_LINE_WEIGHT, Number.isFinite(lineWeight) ? lineWeight : 1),
  );
  const wholeLayers = Math.floor(weight);
  const layers = Array.from({ length: wholeLayers }, () => 1);
  const remainder = weight - wholeLayers;
  if (remainder > 0.001) layers.push(remainder);
  return layers.length > 0 ? layers : [weight];
}

export interface PreviewColorTreatment {
  mode: "light-background" | "dark-background";
  compositeForegroundColor: string;
}

function parseHexColor(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function formatHexColor(channels: number[]): string {
  return `#${channels
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function previewColorTreatment(
  foregroundColor: string,
  backgroundColor: string,
): PreviewColorTreatment {
  const foreground = parseHexColor(normalizeColor(
    foregroundColor,
    DEFAULT_PREVIEW_APPEARANCE.foregroundColor,
  ));
  const background = parseHexColor(normalizeColor(
    backgroundColor,
    DEFAULT_PREVIEW_APPEARANCE.backgroundColor,
  ));
  const luminance = (channels: number[]) =>
    channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  const darkBackground = luminance(background) < luminance(foreground);
  const adjusted = foreground.map((channel, index) => {
    const backdrop = background[index]!;
    if (darkBackground) {
      return backdrop >= 255 ? channel : ((channel - backdrop) * 255) / (255 - backdrop);
    }
    return backdrop <= 0 ? channel : (channel * 255) / backdrop;
  });
  return {
    mode: darkBackground ? "dark-background" : "light-background",
    compositeForegroundColor: formatHexColor(adjusted),
  };
}

export const usePreviewAppearanceStore = defineStore("preview-appearance", {
  state: (): PreviewAppearance => ({ ...DEFAULT_PREVIEW_APPEARANCE }),
  getters: {
    isDefault(state): boolean {
      return state.foregroundColor === DEFAULT_PREVIEW_APPEARANCE.foregroundColor &&
        state.backgroundColor === DEFAULT_PREVIEW_APPEARANCE.backgroundColor &&
        state.lineWeight === DEFAULT_PREVIEW_APPEARANCE.lineWeight;
    },
  },
  actions: {
    setForegroundColor(value: string) {
      this.foregroundColor = normalizeColor(value, DEFAULT_PREVIEW_APPEARANCE.foregroundColor);
    },
    setBackgroundColor(value: string) {
      this.backgroundColor = normalizeColor(value, DEFAULT_PREVIEW_APPEARANCE.backgroundColor);
    },
    setLineWeight(value: number) {
      this.lineWeight = Math.max(
        MIN_PREVIEW_LINE_WEIGHT,
        Math.min(MAX_PREVIEW_LINE_WEIGHT, Number.isFinite(value) ? value : 1),
      );
    },
    reset() {
      this.$patch(DEFAULT_PREVIEW_APPEARANCE);
    },
  },
});
