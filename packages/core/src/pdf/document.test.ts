import { describe, expect, it } from "vitest";

import { validateUniformPageSizes } from "./document";

describe("validateUniformPageSizes", () => {
  it("accepts pages inside the point tolerance", () => {
    expect(
      validateUniformPageSizes([
        { pageNumber: 1, width: 841.89, height: 1190.551 },
        { pageNumber: 2, width: 841.899, height: 1190.56 },
      ]),
    ).toEqual({ width: 841.89, height: 1190.551 });
  });

  it("identifies the mismatching page", () => {
    expect(() =>
      validateUniformPageSizes([
        { pageNumber: 1, width: 841.89, height: 1190.551 },
        { pageNumber: 2, width: 595.28, height: 841.89 },
      ]),
    ).toThrow(/第 2 页尺寸/);
  });

  it("rejects empty documents", () => {
    expect(() => validateUniformPageSizes([])).toThrow(/没有可用页面/);
  });
});
