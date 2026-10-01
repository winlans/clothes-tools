export interface SpacerAppearance {
  accentColor: string;
  washOpacity: number;
  hatchOpacity: number;
  borderOpacity: number;
}

function colorLuminance(color: string): number {
  const compact = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!compact) return 1;
  const expanded = compact.length === 3
    ? compact.split("").map((part) => part + part).join("")
    : compact;
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

export function spacerAppearance(backgroundColor: string): SpacerAppearance {
  const darkBackground = colorLuminance(backgroundColor) < 0.28;
  return {
    accentColor: darkBackground ? "#82d7df" : "#2b747c",
    washOpacity: darkBackground ? 0.075 : 0.045,
    hatchOpacity: darkBackground ? 0.22 : 0.16,
    borderOpacity: darkBackground ? 0.72 : 0.58,
  };
}
