import { describe, expect, it } from "vitest";

import {
  ZMachine,
  type ZMachineCheckpoint,
  type ZMachineIO,
  type ZMachineOptions,
} from "../vendor/dork/src/zmachine/index.js";

const STORY_BYTES = 2048;
const INITIAL_PC = 0x400;
const GLOBALS_TABLE = 0x80;
const OBJECT_TABLE = 0x300;
const ABBREVIATIONS_TABLE = 0x380;
const TEXT_BUFFER = 0x200;
const PARSE_BUFFER = 0x280;
const INPUT_MAX_LENGTH = 60;

const RESULT_A = 16;
const RESULT_B = 17;
const RESULT_C = 18;
const UNUSED_RESULT = 19;

interface InputBoundary {
  readonly output: string;
  readonly maxLength: number;
}

interface RunningMachine {
  readonly machine: ZMachine;
  readonly io: BoundaryIo;
}

class BoundaryIo implements ZMachineIO {
  readonly #boundaries: InputBoundary[] = [];
  readonly #waiters: Array<{
    readonly resolve: (boundary: InputBoundary) => void;
    readonly reject: (error: unknown) => void;
  }> = [];
  #output = "";
  #pending:
    | {
        readonly maxLength: number;
        readonly resolve: (command: string) => void;
      }
    | undefined;
  #failure: unknown;

  public print(text: string): void {
    this.#output += text;
  }

  public read(maxLength: number): Promise<string> {
    if (this.#pending) throw new Error("overlapping RNG fixture input");
    return new Promise<string>((resolve) => {
      this.#pending = { maxLength, resolve };
      const boundary = { output: this.#output, maxLength };
      this.#output = "";
      const waiter = this.#waiters.shift();
      if (waiter) waiter.resolve(boundary);
      else this.#boundaries.push(boundary);
    });
  }

  public nextBoundary(): Promise<InputBoundary> {
    const boundary = this.#boundaries.shift();
    if (boundary) return Promise.resolve(boundary);
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    return new Promise<InputBoundary>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }

  public submit(command: string): void {
    const pending = this.#pending;
    if (!pending) throw new Error("RNG fixture is not awaiting input");
    if (command.length >= pending.maxLength) {
      throw new RangeError("RNG fixture command is too long");
    }
    this.#pending = undefined;
    pending.resolve(command);
  }

  public fail(error: unknown): void {
    this.#failure = error;
    this.#pending = undefined;
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }
}

function putWord(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function emitRandom(
  program: number[],
  operand: number,
  storeVariable: number,
): void {
  if (operand >= 0 && operand <= 0xff) {
    // VAR:random, one small-constant operand, then the store variable.
    program.push(0xe7, 0x7f, operand, storeVariable);
    return;
  }

  // VAR:random, one signed large-constant operand, then the store variable.
  program.push(
    0xe7,
    0x3f,
    (operand >>> 8) & 0xff,
    operand & 0xff,
    storeVariable,
  );
}

function emitPrintCharacter(program: number[], code: number): void {
  // VAR:print_char with one small-constant operand.
  program.push(0xe5, 0x7f, code);
}

function emitPrintAscii(program: number[], text: string): void {
  for (const character of text) {
    emitPrintCharacter(program, character.charCodeAt(0));
  }
}

function emitPrintNumber(program: number[], variable: number): void {
  // VAR:print_num with one variable operand.
  program.push(0xe6, 0xbf, variable);
}

function emitTriple(program: number[], label: string): void {
  emitPrintAscii(program, `${label}:`);
  emitPrintNumber(program, RESULT_A);
  emitPrintCharacter(program, 44);
  emitPrintNumber(program, RESULT_B);
  emitPrintCharacter(program, 44);
  emitPrintNumber(program, RESULT_C);
  emitPrintCharacter(program, 13);
}

function emitRead(program: number[]): void {
  // V3 VAR:sread with two large-constant buffer operands.
  program.push(
    0xe4,
    0x0f,
    TEXT_BUFFER >>> 8,
    TEXT_BUFFER & 0xff,
    PARSE_BUFFER >>> 8,
    PARSE_BUFFER & 0xff,
  );
}

/**
 * Build a tiny project-owned V3 story directly in memory. Its four boundaries
 * are:
 *
 * 1. three positive RANDOM draws;
 * 2. RANDOM 0 followed by three draws;
 * 3. RANDOM -7 followed by three predictable draws; and
 * 4. RESTART followed by the first phase again.
 *
 * The story deliberately uses no compiled binary fixture or imported asset.
 */
function buildRngStory(): Uint8Array {
  const bytes = new Uint8Array(STORY_BYTES);
  bytes[0] = 3;
  putWord(bytes, 2, 1);
  putWord(bytes, 4, INITIAL_PC);
  putWord(bytes, 6, INITIAL_PC);
  putWord(bytes, 8, 0); // An empty dictionary is sufficient for ignored input.
  putWord(bytes, 10, OBJECT_TABLE);
  putWord(bytes, 12, GLOBALS_TABLE);
  putWord(bytes, 14, INITIAL_PC);
  bytes.set(new TextEncoder().encode("260818"), 18);
  putWord(bytes, 24, ABBREVIATIONS_TABLE);
  putWord(bytes, 26, STORY_BYTES / 2);

  bytes[TEXT_BUFFER] = INPUT_MAX_LENGTH;
  bytes[PARSE_BUFFER] = 0;

  const program: number[] = [];

  for (const result of [RESULT_A, RESULT_B, RESULT_C]) {
    emitRandom(program, 100, result);
  }
  emitTriple(program, "P");
  emitRead(program);

  emitRandom(program, 0, UNUSED_RESULT);
  for (const result of [RESULT_A, RESULT_B, RESULT_C]) {
    emitRandom(program, 100, result);
  }
  emitTriple(program, "Z");
  emitRead(program);

  emitRandom(program, -7, UNUSED_RESULT);
  for (const result of [RESULT_A, RESULT_B, RESULT_C]) {
    emitRandom(program, 100, result);
  }
  emitTriple(program, "N");
  emitRead(program);

  program.push(0xb7); // 0OP:restart
  bytes.set(program, INITIAL_PC);

  let checksum = 0;
  for (let offset = 64; offset < bytes.length; offset++) {
    checksum = (checksum + bytes[offset]!) & 0xffff;
  }
  putWord(bytes, 28, checksum);
  return bytes;
}

function startMachine(
  story: Uint8Array,
  options: ZMachineOptions,
  checkpoint?: ZMachineCheckpoint,
): RunningMachine {
  const io = new BoundaryIo();
  const machine = new ZMachine(story, io, options);
  void machine.run(checkpoint).catch((error: unknown) => io.fail(error));
  return { machine, io };
}

function expectRng(
  checkpoint: ZMachineCheckpoint,
  expected: readonly [0 | 1, number, number],
): void {
  expect([
    checkpoint.rngMode,
    checkpoint.gameplayState,
    checkpoint.reseedState,
  ]).toEqual(expected);
}

describe("Dork V3 machine RNG checkpoint regression", () => {
  it("keeps RANDOM, reseeding, predictable mode, and RESTART exact across cold restores", async () => {
    const story = buildRngStory();
    const options = {
      seed: 0x1234_5678,
      maxInstructionsPerTurn: 10_000,
    } as const;
    const active = startMachine(story, options);

    expect(await active.io.nextBoundary()).toEqual({
      output: "P:10,100,64\n",
      maxLength: INPUT_MAX_LENGTH,
    });
    expectRng(
      active.machine.checkpointAtInput(),
      [0, 0xa336_831b, 0xb06b_d031],
    );

    const advanceThroughColdRestore = async (
      expectedOutput: string,
      expectedRng: readonly [0 | 1, number, number],
    ): Promise<void> => {
      const checkpoint = active.machine.checkpointAtInput();
      const restored = startMachine(
        story,
        { ...options, seed: 0xdead_beef },
        checkpoint,
      );

      expect(await restored.io.nextBoundary()).toEqual({
        output: "",
        maxLength: INPUT_MAX_LENGTH,
      });
      expect(restored.machine.checkpointAtInput()).toEqual(checkpoint);

      active.io.submit("continue");
      restored.io.submit("continue");
      const [uninterruptedBoundary, restoredBoundary] = await Promise.all([
        active.io.nextBoundary(),
        restored.io.nextBoundary(),
      ]);
      expect(uninterruptedBoundary).toEqual({
        output: expectedOutput,
        maxLength: INPUT_MAX_LENGTH,
      });
      expect(restoredBoundary).toEqual(uninterruptedBoundary);

      const uninterruptedCheckpoint = active.machine.checkpointAtInput();
      expect(restored.machine.checkpointAtInput()).toEqual(
        uninterruptedCheckpoint,
      );
      expectRng(uninterruptedCheckpoint, expectedRng);
    };

    await advanceThroughColdRestore(
      "Z:41,29,12\n",
      [0, 0x1d52_3df5, 0x4ea3_49ea],
    );
    await advanceThroughColdRestore(
      "N:24,92,62\n",
      [1, 0x9ccc_40fc, 0x4ea3_49ea],
    );
    await advanceThroughColdRestore(
      "P:15,79,90\n",
      [0, 0xe494_d946, 0xecda_c3a3],
    );
  });
});
