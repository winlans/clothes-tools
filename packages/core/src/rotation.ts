export const QUARTER_TURNS = [0, 90, 180, 270] as const;

export type QuarterTurn = (typeof QUARTER_TURNS)[number];

export function isQuarterTurn(value: unknown): value is QuarterTurn {
  return typeof value === "number" && QUARTER_TURNS.includes(value as QuarterTurn);
}

export function rotateQuarterTurn(
  current: QuarterTurn,
  direction: -1 | 1,
): QuarterTurn {
  const index = QUARTER_TURNS.indexOf(current);
  return QUARTER_TURNS[(index + direction + QUARTER_TURNS.length) % QUARTER_TURNS.length] ?? 0;
}

export function rotatedSize<T extends { width: number; height: number }>(
  size: T,
  rotation: QuarterTurn,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}
