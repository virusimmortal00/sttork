import {
  canonicalizeCommand,
  type CanonicalCommand,
  type EngineTurnBoundary,
} from "@zork-voice/contracts";

import {
  ZMachine,
  type ZMachineCheckpoint,
  type ZMachineIO,
  type ZMachineOptions,
} from "../../vendor/dork/src/zmachine/index.js";
import {
  decodeDorkCheckpointEnvelope,
  DORK_CHECKPOINT_ADAPTER_ID,
  DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES,
  DORK_CHECKPOINT_RUNTIME_ID,
  DORK_CHECKPOINT_SCHEMA_VERSION,
  encodeDorkCheckpointEnvelope,
} from "./checkpoint-envelope.js";

export interface DorkCandidateTurn {
  readonly output: string;
  readonly turnComplete: true;
  readonly boundary: EngineTurnBoundary;
}

export interface DorkCandidatePublicState {
  readonly revision: number;
  readonly lastOutput: string;
  readonly boundary: EngineTurnBoundary;
}

interface ResolvedDorkCandidateOptions {
  readonly isTandy: boolean;
  readonly seed: number;
  readonly strict: boolean;
  readonly maxInstructions: number;
  readonly maxInstructionsPerTurn: number;
}

const DEFAULT_MAX_INSTRUCTIONS_PER_TURN = 1_000_000;
const MAX_INSTRUCTIONS_PER_TURN = 10_000_000;

function secureRandomSeed(): number {
  const crypto = globalThis.crypto;
  if (crypto === undefined) {
    throw new DorkCandidateSessionStateError(
      "Secure randomness is unavailable for the Dork session seed",
    );
  }
  const words = new Uint32Array(1);
  crypto.getRandomValues(words);
  return words[0]!;
}

function resolveOptions(
  options: ZMachineOptions,
): ResolvedDorkCandidateOptions {
  const maxInstructionsPerTurn =
    options.maxInstructionsPerTurn ?? DEFAULT_MAX_INSTRUCTIONS_PER_TURN;
  if (
    !Number.isSafeInteger(maxInstructionsPerTurn) ||
    maxInstructionsPerTurn < 1 ||
    maxInstructionsPerTurn > MAX_INSTRUCTIONS_PER_TURN
  ) {
    throw new RangeError(
      `Dork maxInstructionsPerTurn must be between 1 and ${MAX_INSTRUCTIONS_PER_TURN}`,
    );
  }

  return {
    isTandy: options.isTandy === true,
    seed: options.seed ?? secureRandomSeed(),
    strict: options.strict !== false,
    maxInstructions: options.maxInstructions ?? Infinity,
    maxInstructionsPerTurn,
  };
}

function optionsFromCheckpoint(
  checkpoint: ZMachineCheckpoint,
): ResolvedDorkCandidateOptions {
  return resolveOptions({
    isTandy: checkpoint.config.isTandy,
    seed: checkpoint.reseedState,
    strict: checkpoint.config.strict,
    maxInstructions: checkpoint.config.maxInstructions ?? Infinity,
    maxInstructionsPerTurn: checkpoint.config.maxInstructionsPerTurn,
  });
}

function sameOptions(
  left: ResolvedDorkCandidateOptions,
  right: ResolvedDorkCandidateOptions,
): boolean {
  return (
    left.isTandy === right.isTandy &&
    left.strict === right.strict &&
    left.maxInstructions === right.maxInstructions &&
    left.maxInstructionsPerTurn === right.maxInstructionsPerTurn
  );
}

function storyId(story: Uint8Array): string {
  const byteSwapped = (story[1]! & 1) !== 0;
  const release = byteSwapped
    ? story[2]! | (story[3]! << 8)
    : (story[2]! << 8) | story[3]!;
  const checksum = byteSwapped
    ? story[28]! | (story[29]! << 8)
    : (story[28]! << 8) | story[29]!;
  const serial = String.fromCharCode(...story.slice(18, 24));
  return `zcode-v3-r${release}-s${serial}-c${checksum.toString(16).padStart(4, "0")}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const crypto = globalThis.crypto;
  if (crypto === undefined) {
    throw new DorkCandidateSessionStateError(
      "Web Crypto is unavailable for Dork story verification",
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class DorkCandidateSessionStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DorkCandidateSessionStateError";
  }
}

interface PendingRead {
  readonly maxLength: number;
  readonly resolve: (command: string) => void;
  readonly reject: (error: unknown) => void;
}

interface BoundaryWaiter {
  readonly resolve: (turn: DorkCandidateTurn) => void;
  readonly reject: (error: unknown) => void;
}

class DorkCandidateIo implements ZMachineIO {
  static readonly maxOutputBytes = DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES;

  readonly #turns: DorkCandidateTurn[] = [];
  readonly #waiters: BoundaryWaiter[] = [];
  #pendingRead: PendingRead | undefined;
  #output = "";
  #outputBytes = 0;
  #inputBoundaryCount = 0;
  #disposed = false;
  #failed = false;
  #terminalError: unknown;
  #terminated = false;

  public print(text: string): void {
    if (this.#disposed) {
      throw new DorkCandidateSessionStateError(
        "Dork printed output after its host session was disposed",
      );
    }
    if (this.#terminated) {
      throw new DorkCandidateSessionStateError(
        "Dork printed output after termination",
      );
    }
    if (text.length > DorkCandidateIo.maxOutputBytes) {
      throw new DorkCandidateSessionStateError(
        `Dork exceeded the ${DorkCandidateIo.maxOutputBytes}-byte output limit for one turn`,
      );
    }
    const nextBytes = new TextEncoder().encode(text).byteLength;
    if (this.#outputBytes + nextBytes > DorkCandidateIo.maxOutputBytes) {
      throw new DorkCandidateSessionStateError(
        `Dork exceeded the ${DorkCandidateIo.maxOutputBytes}-byte output limit for one turn`,
      );
    }
    this.#outputBytes += nextBytes;
    this.#output += text;
  }

  public read(maxLength: number): Promise<string> {
    if (this.#disposed) {
      throw new DorkCandidateSessionStateError(
        "Dork requested input after its host session was disposed",
      );
    }
    if (
      !Number.isSafeInteger(maxLength) ||
      maxLength < 1 ||
      maxLength > 0xffff
    ) {
      throw new RangeError("Dork requested an invalid input length");
    }
    if (this.#pendingRead !== undefined) {
      throw new DorkCandidateSessionStateError(
        "Dork requested overlapping input",
      );
    }

    return new Promise<string>((resolve, reject) => {
      this.#pendingRead = { maxLength, resolve, reject };
      this.#inputBoundaryCount += 1;
      this.#emit({
        output: this.#drainOutput(),
        turnComplete: true,
        boundary: "input-requested",
      });
    });
  }

  public submit(command: CanonicalCommand): void {
    if (this.#disposed) {
      throw new DorkCandidateSessionStateError(
        "Dork candidate session is disposed",
      );
    }
    if (this.#terminated) {
      throw new DorkCandidateSessionStateError(
        "Dork has terminated and cannot accept another command",
      );
    }
    const pending = this.#pendingRead;
    if (pending === undefined) {
      throw new DorkCandidateSessionStateError(
        "Dork is not waiting for a command",
      );
    }
    if (command.length >= pending.maxLength) {
      throw new RangeError(
        `Command length ${command.length} exceeds the story input limit ${pending.maxLength - 1}`,
      );
    }

    this.#pendingRead = undefined;
    pending.resolve(command);
  }

  public nextTurn(): Promise<DorkCandidateTurn> {
    if (this.#disposed) {
      return Promise.reject(
        new DorkCandidateSessionStateError(
          "Dork candidate session is disposed",
        ),
      );
    }
    const queued = this.#turns.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.#failed) {
      return Promise.reject(this.#terminalError);
    }
    return new Promise<DorkCandidateTurn>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }

  public finish(): void {
    if (this.#disposed) return;
    if (this.#terminated) return;
    this.#terminated = true;
    this.#emit({
      output: this.#drainOutput(),
      turnComplete: true,
      boundary: "terminated",
    });
  }

  public fail(error: unknown): void {
    if (this.#disposed) return;
    if (this.#failed) return;
    this.#failed = true;
    this.#terminalError = error;
    const waiters = this.#waiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#terminated = true;
    const disposalError = new DorkCandidateSessionStateError(
      "Dork candidate session is disposed",
    );
    const pending = this.#pendingRead;
    this.#pendingRead = undefined;
    pending?.reject(disposalError);
    this.#turns.splice(0);
    const waiters = this.#waiters.splice(0);
    for (const waiter of waiters) waiter.reject(disposalError);
    this.#output = "";
    this.#outputBytes = 0;
  }

  public assertSingleInputBoundary(): void {
    if (
      this.#disposed ||
      this.#failed ||
      this.#terminated ||
      this.#pendingRead === undefined ||
      this.#inputBoundaryCount !== 1 ||
      this.#turns.length !== 0 ||
      this.#waiters.length !== 0 ||
      this.#output !== "" ||
      this.#outputBytes !== 0
    ) {
      throw new DorkCandidateSessionStateError(
        "Dork did not settle at exactly one clean input boundary",
      );
    }
  }

  public get waitingForInput(): boolean {
    return this.#pendingRead !== undefined;
  }

  #drainOutput(): string {
    const output = this.#output;
    this.#output = "";
    this.#outputBytes = 0;
    return output;
  }

  #emit(turn: DorkCandidateTurn): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#turns.push(turn);
    else waiter.resolve(turn);
  }
}

/** Bounded ADR-0009 spike; production workers still use EnginePort. */
export class DorkCandidateSession {
  readonly #story: Uint8Array;
  readonly #storyId: string;
  readonly #artifactSha256: Promise<string>;
  #options: ResolvedDorkCandidateOptions;
  #machine: ZMachine;
  #io: DorkCandidateIo;
  #started = false;
  #disposed = false;
  #lifecycleEpoch = 0;
  #operationInFlight = false;
  #revision = 0;
  #lastOutput = "";
  #boundary: EngineTurnBoundary = "input-requested";

  public constructor(story: Uint8Array, options: ZMachineOptions = {}) {
    if (story.byteLength < 64) {
      throw new RangeError("A Dork candidate story must contain a full header");
    }
    if (story[0] !== 3) {
      throw new RangeError(
        "The Dork candidate spike accepts only version 3 stories",
      );
    }
    this.#story = new Uint8Array(story);
    this.#storyId = storyId(this.#story);
    this.#artifactSha256 = sha256(this.#story);
    this.#options = resolveOptions(options);
    this.#io = new DorkCandidateIo();
    this.#machine = new ZMachine(this.#story, this.#io, this.#options);
  }

  public static async restoreFromSnapshot(
    story: Uint8Array,
    snapshot: Uint8Array,
  ): Promise<DorkCandidateSession> {
    if (!(snapshot instanceof Uint8Array)) {
      throw new TypeError("A Dork candidate snapshot must be a Uint8Array");
    }
    // The codec applies its hard size cap before making its single detached
    // copy, then validates the copy in two passes before materializing state.
    const envelope = decodeDorkCheckpointEnvelope(snapshot);
    const candidate = new DorkCandidateSession(
      story,
      optionsFromCheckpoint(envelope.machine),
    );

    try {
      const artifactSha256 = await candidate.#artifactSha256;
      if (
        envelope.storyId !== candidate.#storyId ||
        envelope.artifactSha256 !== artifactSha256
      ) {
        throw new DorkCandidateSessionStateError(
          "Dork checkpoint does not match the supplied story artifact",
        );
      }

      candidate.#started = true;
      candidate.#revision = envelope.revision;
      candidate.#lastOutput = envelope.lastOutput;
      candidate.#launch(envelope.machine);
      const restoredBoundary = await candidate.#io.nextTurn();
      if (
        restoredBoundary.boundary !== "input-requested" ||
        restoredBoundary.output !== ""
      ) {
        throw new DorkCandidateSessionStateError(
          "Dork checkpoint restore produced output or failed to request input",
        );
      }
      candidate.#io.assertSingleInputBoundary();
      candidate.#boundary = "input-requested";
      return candidate;
    } catch (error) {
      candidate.dispose();
      throw error;
    }
  }

  public async boot(): Promise<DorkCandidateTurn> {
    this.#assertUsable();
    if (this.#started) {
      throw new DorkCandidateSessionStateError(
        "Dork candidate session is already started",
      );
    }
    this.#started = true;
    this.#beginOperation();
    this.#launch();
    try {
      const turn = await this.#io.nextTurn();
      if (turn.boundary === "input-requested") {
        this.#io.assertSingleInputBoundary();
      }
      this.#recordTurn(turn);
      return turn;
    } finally {
      this.#operationInFlight = false;
    }
  }

  public async execute(command: CanonicalCommand): Promise<DorkCandidateTurn> {
    this.#assertUsable();
    if (!this.#started) {
      throw new DorkCandidateSessionStateError(
        "Dork candidate session must be booted first",
      );
    }
    const validated = canonicalizeCommand(command);
    if (validated !== command) {
      throw new TypeError("Dork command must already be in canonical form");
    }
    this.#beginOperation();
    try {
      this.#io.submit(validated);
      const turn = await this.#io.nextTurn();
      this.#revision += 1;
      this.#recordTurn(turn);
      return turn;
    } finally {
      this.#operationInFlight = false;
    }
  }

  public async snapshot(): Promise<Uint8Array> {
    this.#assertAtInputBoundary("snapshot");
    this.#beginOperation();
    try {
      const machine = this.#machine.checkpointAtInput();
      const bytes = encodeDorkCheckpointEnvelope({
        schemaVersion: DORK_CHECKPOINT_SCHEMA_VERSION,
        runtimeId: DORK_CHECKPOINT_RUNTIME_ID,
        adapterId: DORK_CHECKPOINT_ADAPTER_ID,
        storyId: this.#storyId,
        artifactSha256: await this.#artifactSha256,
        revision: this.#revision,
        lastOutput: this.#lastOutput,
        machine,
      });
      return bytes;
    } finally {
      this.#operationInFlight = false;
    }
  }

  public async restore(snapshot: Uint8Array): Promise<DorkCandidateTurn> {
    this.#assertAtInputBoundary("restore");
    const lifecycleEpoch = this.#lifecycleEpoch;
    this.#beginOperation();
    let candidate: DorkCandidateSession | undefined;
    try {
      candidate = await DorkCandidateSession.restoreFromSnapshot(
        this.#story,
        snapshot,
      );
      if (!sameOptions(candidate.#options, this.#options)) {
        throw new DorkCandidateSessionStateError(
          "Dork checkpoint runtime configuration does not match the active session",
        );
      }
      if (this.#disposed || this.#lifecycleEpoch !== lifecycleEpoch) {
        throw new DorkCandidateSessionStateError(
          "Dork candidate session lifecycle changed while restore was staged",
        );
      }

      const oldIo = this.#io;
      this.#machine = candidate.#machine;
      this.#io = candidate.#io;
      this.#options = candidate.#options;
      this.#revision = candidate.#revision;
      this.#lastOutput = candidate.#lastOutput;
      this.#boundary = "input-requested";
      candidate = undefined;
      oldIo.dispose();

      return {
        output: "",
        turnComplete: true,
        boundary: "input-requested",
      };
    } finally {
      candidate?.dispose();
      this.#operationInFlight = false;
    }
  }

  public inspectPublicState(): DorkCandidatePublicState {
    this.#assertUsable();
    return {
      revision: this.#revision,
      lastOutput: this.#lastOutput,
      boundary: this.#boundary,
    };
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#lifecycleEpoch += 1;
    this.#io.dispose();
  }

  #launch(checkpoint?: ZMachineCheckpoint): void {
    const machine = this.#machine;
    const io = this.#io;
    void machine.run(checkpoint).then(
      () => io.finish(),
      (error: unknown) => io.fail(error),
    );
  }

  #recordTurn(turn: DorkCandidateTurn): void {
    this.#lastOutput = turn.output;
    this.#boundary = turn.boundary;
  }

  #assertAtInputBoundary(operation: string): void {
    this.#assertUsable();
    if (!this.#started) {
      throw new DorkCandidateSessionStateError(
        `Dork candidate session must be booted before ${operation}`,
      );
    }
    if (this.#boundary !== "input-requested" || !this.#io.waitingForInput) {
      throw new DorkCandidateSessionStateError(
        `Dork candidate session can only ${operation} at an input boundary`,
      );
    }
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new DorkCandidateSessionStateError(
        "Dork candidate session is disposed",
      );
    }
  }

  #beginOperation(): void {
    if (this.#operationInFlight) {
      throw new DorkCandidateSessionStateError(
        "A Dork candidate operation is already in flight",
      );
    }
    this.#operationInFlight = true;
  }
}
