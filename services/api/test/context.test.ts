import {describe, expect, it} from "vitest";
import {isAddress, isHash, pagination} from "../src/context.js";

describe("isAddress", () => {
  it("accepts a 20-byte hex address in any casing", () => {
    expect(isAddress("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266")).toBe(true);
    expect(isAddress("0xF39Fd6E51AAD88F6F4CE6AB8827279CFFFB92266")).toBe(true);
  });

  it("rejects near-misses that would produce unjoinable rows", () => {
    for (const bad of [
      "0xf39fd6e51aad88f6f4ce6ab8827279cfffb9226", // 39 chars
      "0xf39fd6e51aad88f6f4ce6ab8827279cfffb922660", // 41 chars
      "f39fd6e51aad88f6f4ce6ab8827279cfffb92266", // no 0x
      `0x${"g".repeat(40)}`, // non-hex
      "",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isAddress(bad)).toBe(false);
    }
  });
});

describe("isHash", () => {
  it("accepts a 32-byte hash", () => {
    expect(isHash(`0x${"a".repeat(64)}`)).toBe(true);
  });

  it("rejects an address-length value", () => {
    expect(isHash(`0x${"a".repeat(40)}`)).toBe(false);
  });

  it("rejects wrong lengths and non-hex", () => {
    expect(isHash(`0x${"a".repeat(63)}`)).toBe(false);
    expect(isHash(`0x${"a".repeat(65)}`)).toBe(false);
    expect(isHash(`0x${"z".repeat(64)}`)).toBe(false);
  });
});

describe("pagination", () => {
  it("defaults to 25 from offset 0", () => {
    expect(pagination({})).toEqual({limit: 25, offset: 0});
  });

  it("honours explicit values", () => {
    expect(pagination({limit: "10", offset: "40"})).toEqual({limit: 10, offset: 40});
  });

  /** A caller must not be able to request the entire table in one query. */
  it("caps limit at 100", () => {
    expect(pagination({limit: "5000"}).limit).toBe(100);
    expect(pagination({limit: Number.MAX_SAFE_INTEGER}).limit).toBe(100);
  });

  it("floors limit at 1", () => {
    expect(pagination({limit: "0"}).limit).toBe(1);
    expect(pagination({limit: "-10"}).limit).toBe(1);
  });

  it("never returns a negative offset", () => {
    expect(pagination({offset: "-5"}).offset).toBe(0);
  });

  it("falls back to defaults on garbage rather than producing NaN in SQL", () => {
    expect(pagination({limit: "abc", offset: "xyz"})).toEqual({limit: 25, offset: 0});
    expect(pagination({limit: "NaN"})).toEqual({limit: 25, offset: 0});
  });

  it("truncates fractional input", () => {
    expect(pagination({limit: "10.9", offset: "3.7"})).toEqual({limit: 10, offset: 3});
  });
});
