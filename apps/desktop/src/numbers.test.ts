import { describe, expect, it } from "vitest";

import { formatUiNumber, roundUiNumber } from "./numbers";

describe("UI number formatting", () => {
  it("shows at most three decimal places", () => {
    expect(formatUiNumber(841.920043945312)).toBe("841.92");
    expect(formatUiNumber(86.094305)).toBe("86.094");
    expect(formatUiNumber(13.9994)).toBe("13.999");
    expect(formatUiNumber(13.9996)).toBe("14");
    expect(roundUiNumber(-0.0001)).toBe(0);
  });
});
