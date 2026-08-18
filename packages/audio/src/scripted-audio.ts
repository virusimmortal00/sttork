import type {
  NarrationPort,
  NarrationRequest,
} from "../../session/src/index.js";

import type {
  AudioClock,
  CapturedAudioTurn,
  CapturePort,
  FinalTranscript,
  PlaybackPort,
  PlaybackRecord,
  TranscriberPort,
} from "./contracts.js";

export class ScriptedAudioError extends Error {
  public readonly code: "no-speech" | "capture-empty" | "unknown-clip";

  public constructor(
    code: "no-speech" | "capture-empty" | "unknown-clip",
    message: string,
  ) {
    super(message);
    this.name = "ScriptedAudioError";
    this.code = code;
  }
}

export interface ScriptedClip extends CapturedAudioTurn {
  readonly transcript?: FinalTranscript;
}

export class ScriptedCapturePort implements CapturePort {
  readonly #clips: ScriptedClip[];
  #activeCaptureId: string | undefined;

  public constructor(clips: readonly ScriptedClip[]) {
    this.#clips = clips.map((clip) => ({ ...clip }));
  }

  public async start(captureId: string): Promise<void> {
    if (this.#activeCaptureId !== undefined) {
      throw new ScriptedAudioError(
        "capture-empty",
        "Capture is already active.",
      );
    }
    this.#activeCaptureId = captureId;
  }

  public async stop(captureId: string): Promise<CapturedAudioTurn> {
    if (this.#activeCaptureId !== captureId) {
      throw new ScriptedAudioError(
        "capture-empty",
        "Capture ID is not active.",
      );
    }
    this.#activeCaptureId = undefined;
    const clip = this.#clips.shift();
    if (clip === undefined) {
      throw new ScriptedAudioError(
        "capture-empty",
        "No scripted clip remains.",
      );
    }
    return { clipId: clip.clipId, durationMs: clip.durationMs };
  }

  public async cancel(captureId: string): Promise<void> {
    if (this.#activeCaptureId === captureId) this.#activeCaptureId = undefined;
  }
}

export class ScriptedTranscriber implements TranscriberPort {
  readonly #transcripts: ReadonlyMap<string, FinalTranscript | undefined>;

  public constructor(clips: readonly ScriptedClip[]) {
    this.#transcripts = new Map(
      clips.map((clip) => [
        clip.clipId,
        clip.transcript === undefined ? undefined : { ...clip.transcript },
      ]),
    );
  }

  public async transcribe(
    audio: CapturedAudioTurn,
    signal: AbortSignal,
  ): Promise<FinalTranscript> {
    signal.throwIfAborted();
    if (!this.#transcripts.has(audio.clipId)) {
      throw new ScriptedAudioError("unknown-clip", "The clip is not scripted.");
    }
    const transcript = this.#transcripts.get(audio.clipId);
    if (transcript === undefined || transcript.text.trim().length === 0) {
      throw new ScriptedAudioError("no-speech", "No speech was detected.");
    }
    return { ...transcript };
  }
}

export class VirtualAudioClock implements AudioClock {
  #nowMs = 0;

  public get nowMs(): number {
    return this.#nowMs;
  }

  public async wait(durationMs: number, signal: AbortSignal): Promise<void> {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
      throw new RangeError(
        "Virtual duration must be a non-negative safe integer.",
      );
    }
    signal.throwIfAborted();
    this.#nowMs += durationMs;
    await Promise.resolve();
    signal.throwIfAborted();
  }
}

export class ScriptedPlaybackPort implements PlaybackPort {
  public readonly records: PlaybackRecord[] = [];
  readonly #clock: AudioClock;

  public constructor(clock: AudioClock) {
    this.#clock = clock;
  }

  public async play(
    request: NarrationRequest,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAtMs = this.#clock.nowMs;
    const durationMs = Math.max(100, request.text.length * 12);
    await this.#clock.wait(durationMs, signal);
    this.records.push({
      narrationId: request.narrationId,
      role: request.role,
      text: request.text,
      startedAtMs,
      endedAtMs: this.#clock.nowMs,
    });
  }

  public async stop(): Promise<void> {
    await Promise.resolve();
  }
}

export class ScriptedNarrationPort implements NarrationPort {
  readonly #prepared = new Map<string, NarrationRequest[]>();

  public async prepare(
    input: NarrationRequest,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const requests = this.#prepared.get(input.correlationId) ?? [];
    requests.push({ ...input });
    this.#prepared.set(input.correlationId, requests);
  }

  public takePrepared(correlationId: string): readonly NarrationRequest[] {
    const requests = this.#prepared.get(correlationId) ?? [];
    this.#prepared.delete(correlationId);
    return requests.map((request) => ({ ...request }));
  }
}
