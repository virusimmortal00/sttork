import { Memory } from "../vendor/dork/src/zmachine/memory.js";
import { Vocabulary } from "../vendor/dork/src/zmachine/vocab.js";
import { describe, expect, it } from "vitest";

describe("Dork V3 input token bounds", () => {
  it("never writes more entries than the story parse buffer allows", () => {
    const bytes = new Uint8Array(256);
    const memory = new Memory(bytes, false);
    const textBuffer = 64;
    const parseBuffer = 128;
    bytes[textBuffer] = 60;
    bytes[parseBuffer] = 2;
    bytes.fill(0xa5, parseBuffer + 2 + 2 * 4, parseBuffer + 2 + 4 * 4);
    const vocabulary = new Vocabulary(memory, 0, 0);

    vocabulary.handleInput(
      memory,
      "one two three four",
      textBuffer,
      parseBuffer,
      3,
    );

    expect(bytes[parseBuffer + 1]).toBe(2);
    expect(
      Array.from(bytes.slice(parseBuffer + 2 + 2 * 4, parseBuffer + 2 + 4 * 4)),
    ).toEqual(new Array<number>(8).fill(0xa5));
  });
});
