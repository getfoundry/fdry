import { describe, expect, it } from "vitest";

import { decimalAmountToBaseUnits } from "./voltrUserClient";

describe("decimalAmountToBaseUnits", () => {
  it("converts whole and fractional user amounts exactly", () => {
    expect(decimalAmountToBaseUnits("1", 9)).toBe(1_000_000_000n);
    expect(decimalAmountToBaseUnits("1.23", 6)).toBe(1_230_000n);
    expect(decimalAmountToBaseUnits(5, 0)).toBe(5n);
  });

  it("rejects imprecise or invalid inputs before building a tx", () => {
    expect(() => decimalAmountToBaseUnits("0", 9)).toThrow(/greater than zero/);
    expect(() => decimalAmountToBaseUnits("-1", 9)).toThrow(/positive decimal/);
    expect(() => decimalAmountToBaseUnits("1.0000000001", 9)).toThrow(
      /decimal places/,
    );
  });
});
