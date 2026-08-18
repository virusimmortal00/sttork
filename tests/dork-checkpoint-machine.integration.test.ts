import { readFile } from "node:fs/promises";

import {
  ZMachine,
  type ZMachineCheckpoint,
  type ZMachineIO,
  type ZMachineOptions,
} from "../vendor/dork/src/zmachine/index.js";
import { describe, expect, it } from "vitest";

const minimalStoryUrl = new URL(
  "../fixtures/stories/minimal/artifact/minimal.z3",
  import.meta.url,
);

interface InputBoundary {
  readonly output: string;
  readonly maxLength: number;
}

interface PendingRead {
  readonly maxLength: number;
  readonly resolve: (command: string) => void;
  readonly reject: (error: unknown) => void;
}

class CheckpointIo implements ZMachineIO {
  readonly #boundaries: InputBoundary[] = [];
  readonly #waiters: Array<{
    readonly resolve: (boundary: InputBoundary) => void;
    readonly reject: (error: unknown) => void;
  }> = [];
  #output = "";
  #pending: PendingRead | undefined;
  #failure: unknown;
  #failed = false;

  public print(text: string): void {
    this.#output += text;
  }

  public read(maxLength: number): Promise<string> {
    if (this.#pending) throw new Error("overlapping checkpoint test input");
    return new Promise<string>((resolve, reject) => {
      this.#pending = { maxLength, resolve, reject };
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
    if (this.#failed) return Promise.reject(this.#failure);
    return new Promise<InputBoundary>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }

  public submit(command: string): void {
    const pending = this.#pending;
    if (!pending)
      throw new Error("checkpoint test machine is not awaiting input");
    if (command.length >= pending.maxLength)
      throw new RangeError("test command is too long");
    this.#pending = undefined;
    pending.resolve(command);
  }

  public fail(error: unknown): void {
    this.#failed = true;
    this.#failure = error;
    this.#pending?.reject(error);
    this.#pending = undefined;
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }
}

async function minimalStory(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(minimalStoryUrl));
}

function startMachine(
  story: Uint8Array,
  options: ZMachineOptions,
  checkpoint?: ZMachineCheckpoint,
): { readonly machine: ZMachine; readonly io: CheckpointIo } {
  const io = new CheckpointIo();
  const machine = new ZMachine(story, io, options);
  void machine.run(checkpoint).catch((error: unknown) => io.fail(error));
  return { machine, io };
}

describe("Dork host input-boundary checkpoint hook", () => {
  it("resumes a fresh machine without replaying prompt output or diverging state", async () => {
    const story = await minimalStory();
    const options = { seed: 7, maxInstructionsPerTurn: 100_000 } as const;
    const active = startMachine(story, options);

    const boot = await active.io.nextBoundary();
    expect(boot.output).toMatch(/Minimal Fixture[\s\S]*> $/u);

    const callerCopy = active.machine.checkpointAtInput();
    const checkpoint = active.machine.checkpointAtInput();
    expect(checkpoint.callStack.length).toBeGreaterThan(0);
    expect(checkpoint.callStack[0]?.local.length).toBeGreaterThan(0);
    callerCopy.dynamicMemory.fill(0);
    expect(active.machine.checkpointAtInput()).toEqual(checkpoint);

    active.io.submit("north");
    const uninterrupted = await active.io.nextBoundary();
    const uninterruptedCheckpoint = active.machine.checkpointAtInput();

    const restored = startMachine(
      story,
      { ...options, seed: 0xdeadbeef },
      checkpoint,
    );
    const restoredBoundary = await restored.io.nextBoundary();
    expect(restoredBoundary).toEqual({ output: "", maxLength: boot.maxLength });
    expect(restored.machine.checkpointAtInput()).toEqual(checkpoint);

    restored.io.submit("north");
    expect(await restored.io.nextBoundary()).toEqual(uninterrupted);
    expect(restored.machine.checkpointAtInput()).toEqual(
      uninterruptedCheckpoint,
    );
  });

  it("rejects a malformed continuation without mutating the active machine", async () => {
    const story = await minimalStory();
    const options = { seed: 17, maxInstructionsPerTurn: 100_000 } as const;
    const active = startMachine(story, options);
    await active.io.nextBoundary();
    const checkpoint = active.machine.checkpointAtInput();
    const malformed: ZMachineCheckpoint = {
      ...checkpoint,
      pendingRead: {
        ...checkpoint.pendingRead,
        continuationPc: checkpoint.pendingRead.instructionPc,
      },
    };

    const rejectedIo = new CheckpointIo();
    const rejected = new ZMachine(story, rejectedIo, options);
    await expect(rejected.run(malformed)).rejects.toThrow(
      "Invalid ZMachine checkpoint: read continuation ordering",
    );

    active.io.submit("look");
    expect((await active.io.nextBoundary()).output).toBe(
      "South Room\nA plain room with an exit north.\nA brass token rests on the floor.\n\n> ",
    );
  });

  it("bounds each turn independently", async () => {
    const io = new CheckpointIo();
    const machine = new ZMachine(await minimalStory(), io, {
      seed: 1,
      maxInstructionsPerTurn: 1,
    });
    void machine.run().catch((error: unknown) => io.fail(error));

    await expect(io.nextBoundary()).rejects.toThrow(
      "ZMachine: per-turn instruction cap exceeded (1)",
    );
  });
});
