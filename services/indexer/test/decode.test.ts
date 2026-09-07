import {describe, expect, it} from "vitest";
import {decodeTransferLog, normaliseAddress, ERC20_TRANSFER_TOPIC} from "../src/decode.js";

const ALICE = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const BOB = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

/** Right-align an address into a 32-byte topic word, as the EVM does for indexed args. */
function topic(address: string): string {
  return `0x${address.replace(/^0x/, "").padStart(64, "0")}`;
}

/** Left-pad a value into a 32-byte data word. */
function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

describe("decodeTransferLog", () => {
  it("decodes a standard ERC-20 Transfer", () => {
    const result = decodeTransferLog({
      topics: [ERC20_TRANSFER_TOPIC, topic(ALICE), topic(BOB)],
      data: word(1_000_000_000_000_000_000n),
    });
    expect(result).toEqual({from: ALICE, to: BOB, value: 1_000_000_000_000_000_000n});
  });

  it("decodes a zero-value transfer", () => {
    const result = decodeTransferLog({
      topics: [ERC20_TRANSFER_TOPIC, topic(ALICE), topic(BOB)],
      data: word(0n),
    });
    expect(result?.value).toBe(0n);
  });

  it("decodes a full uint256 without losing precision", () => {
    const max = 2n ** 256n - 1n;
    const result = decodeTransferLog({
      topics: [ERC20_TRANSFER_TOPIC, topic(ALICE), topic(BOB)],
      data: word(max),
    });
    expect(result?.value).toBe(max);
  });

  it("decodes mints and burns (zero address on either side)", () => {
    const zero = `0x${"0".repeat(40)}`;
    const mint = decodeTransferLog({
      topics: [ERC20_TRANSFER_TOPIC, topic(zero), topic(BOB)],
      data: word(5n),
    });
    expect(mint).toEqual({from: zero, to: BOB, value: 5n});

    const burn = decodeTransferLog({
      topics: [ERC20_TRANSFER_TOPIC, topic(ALICE), topic(zero)],
      data: word(5n),
    });
    expect(burn?.to).toBe(zero);
  });

  it("lowercases addresses regardless of topic casing", () => {
    const upper = topic(ALICE).toUpperCase().replace("0X", "0x");
    const result = decodeTransferLog({
      topics: [ERC20_TRANSFER_TOPIC, upper, topic(BOB)],
      data: word(1n),
    });
    expect(result?.from).toBe(ALICE);
  });

  it("accepts an uppercase event topic", () => {
    const result = decodeTransferLog({
      topics: [ERC20_TRANSFER_TOPIC.toUpperCase().replace("0X", "0x"), topic(ALICE), topic(BOB)],
      data: word(1n),
    });
    expect(result).not.toBeNull();
  });

  // --- rejections: each of these would corrupt the token_transfers table ---

  it("rejects a different event", () => {
    expect(
      decodeTransferLog({topics: [`0x${"11".repeat(32)}`, topic(ALICE), topic(BOB)], data: word(1n)}),
    ).toBeNull();
  });

  /**
   * An ERC-721 Transfer has the same signature hash but four topics, the last being a
   * tokenId. Treating that as an amount would record NFT IDs as token balances.
   */
  it("rejects a 4-topic ERC-721 Transfer", () => {
    expect(
      decodeTransferLog({
        topics: [ERC20_TRANSFER_TOPIC, topic(ALICE), topic(BOB), word(42n)],
        data: "0x",
      }),
    ).toBeNull();
  });

  it("rejects a Transfer with too few topics", () => {
    expect(decodeTransferLog({topics: [ERC20_TRANSFER_TOPIC, topic(ALICE)], data: word(1n)})).toBeNull();
  });

  it("rejects empty data", () => {
    expect(
      decodeTransferLog({topics: [ERC20_TRANSFER_TOPIC, topic(ALICE), topic(BOB)], data: "0x"}),
    ).toBeNull();
  });

  it("rejects data shorter than one word", () => {
    expect(
      decodeTransferLog({topics: [ERC20_TRANSFER_TOPIC, topic(ALICE), topic(BOB)], data: "0x01"}),
    ).toBeNull();
  });

  it("rejects non-hex data", () => {
    expect(
      decodeTransferLog({
        topics: [ERC20_TRANSFER_TOPIC, topic(ALICE), topic(BOB)],
        data: `0x${"z".repeat(64)}`,
      }),
    ).toBeNull();
  });

  it("rejects a malformed topic", () => {
    expect(
      decodeTransferLog({topics: [ERC20_TRANSFER_TOPIC, "0xdeadbeef", topic(BOB)], data: word(1n)}),
    ).toBeNull();
  });

  it("ignores trailing data beyond the first word", () => {
    const result = decodeTransferLog({
      topics: [ERC20_TRANSFER_TOPIC, topic(ALICE), topic(BOB)],
      data: word(7n) + "ff".repeat(32),
    });
    expect(result?.value).toBe(7n);
  });
});

describe("normaliseAddress", () => {
  it("lowercases a valid address", () => {
    expect(normaliseAddress("0xF39Fd6E51AAD88F6F4CE6AB8827279CFFFB92266")).toBe(ALICE);
  });

  it("rejects anything that is not a 20-byte address", () => {
    for (const bad of ["0x123", "not an address", "", null, undefined, 42, `0x${"a".repeat(64)}`]) {
      expect(normaliseAddress(bad)).toBeNull();
    }
  });
});
