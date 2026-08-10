export const UI_DECIMAL_PLACES = 3;

export function roundUiNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Number(value.toFixed(UI_DECIMAL_PLACES));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatUiNumber(value: number): string {
  return Number.isFinite(value) ? String(roundUiNumber(value)) : "";
}
