import type { NarrationRole } from "../../contracts/src/index.js";
import type {
  NarrationRequest,
  SemanticTurnInput,
  SemanticTurnResult,
} from "../../session/src/index.js";

import type {
  CapturePort,
  PlaybackPort,
  TranscriberPort,
} from "./contracts.js";
import {
  ScriptedAudioError,
  type ScriptedNarrationPort,
} from "./scripted-audio.js";

export type VoiceAudioState =
  | "ready"
  | "listening"
  | "processing"
  | "guide-speaking"
  | "narrator-speaking"
  | "paused"
  | "recoverable-error";

export interface VoiceTurnPort {
  submitTurn(
    input: SemanticTurnInput,
    signal: AbortSignal,
  ): Promise<SemanticTurnResult>;
  recordTranscriptionFailure(input: {
    readonly interactionId: string;
    readonly code: string;
  }): SemanticTurnResult;
  recordAudioFailure(input: {
    readonly interactionId: string;
    readonly code: string;
  }): SemanticTurnResult;
  recordCaptureStarted(input: {
    readonly interactionId: string;
    readonly captureId: string;
  }): unknown;
  recordCaptureEnded(input: {
    readonly interactionId: string;
    readonly captureId: string;
    readonly durationMs: number;
    readonly outcome: "submitted" | "cancelled" | "silence" | "failed";
  }): unknown;
  recordPlaybackStarted(input: {
    readonly interactionId: string;
    readonly narrationId: string;
    readonly role: NarrationRole;
    readonly sourceEventId: string;
  }): unknown;
  recordPlaybackEnded(input: {
    readonly interactionId: string;
    readonly narrationId: string;
    readonly role: NarrationRole;
    readonly sourceEventId: string;
    readonly outcome: "complete" | "interrupted" | "failed";
  }): unknown;
  recordPaused(interactionId: string): unknown;
  recordResumed(interactionId: string): unknown;
}

export interface VoiceAudioControllerOptions {
  readonly turns: VoiceTurnPort;
  readonly capture: CapturePort;
  readonly transcriber: TranscriberPort;
  readonly narration: ScriptedNarrationPort;
  readonly playback: PlaybackPort;
  readonly nextInteractionId: () => string;
  readonly nextCaptureId: () => string;
  readonly observedObjects: () => readonly string[];
  readonly onState?: (state: VoiceAudioState) => void;
  readonly onTurn?: (result: SemanticTurnResult) => void;
}

export class VoiceAudioStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "VoiceAudioStateError";
  }
}

export class VoiceAudioController {
  readonly #turns: VoiceTurnPort;
  readonly #capture: CapturePort;
  readonly #transcriber: TranscriberPort;
  readonly #narration: ScriptedNarrationPort;
  readonly #playback: PlaybackPort;
  readonly #nextInteractionId: () => string;
  readonly #nextCaptureId: () => string;
  readonly #observedObjects: () => readonly string[];
  readonly #onState: ((state: VoiceAudioState) => void) | undefined;
  readonly #onTurn: ((result: SemanticTurnResult) => void) | undefined;
  #state: VoiceAudioState = "ready";
  #active:
    { readonly interactionId: string; readonly captureId: string } | undefined;
  #turnAbort: AbortController | undefined;
  #playbackAbort: AbortController | undefined;
  #lastPlayed: NarrationRequest | undefined;

  public constructor(options: VoiceAudioControllerOptions) {
    this.#turns = options.turns;
    this.#capture = options.capture;
    this.#transcriber = options.transcriber;
    this.#narration = options.narration;
    this.#playback = options.playback;
    this.#nextInteractionId = options.nextInteractionId;
    this.#nextCaptureId = options.nextCaptureId;
    this.#observedObjects = options.observedObjects;
    this.#onState = options.onState;
    this.#onTurn = options.onTurn;
  }

  public get state(): VoiceAudioState {
    return this.#state;
  }

  public async startCapture(): Promise<void> {
    if (this.#state === "paused") {
      throw new VoiceAudioStateError("Cannot capture while paused.");
    }
    if (this.#state !== "ready") {
      throw new VoiceAudioStateError(
        `Cannot start capture while ${this.#state}.`,
      );
    }
    const interactionId = this.#boundedId(
      this.#nextInteractionId(),
      "interaction",
    );
    const captureId = this.#boundedId(this.#nextCaptureId(), "capture");
    try {
      await this.#capture.start(captureId);
    } catch {
      const failed = this.#turns.recordAudioFailure({
        interactionId,
        code: "microphone-unavailable",
      });
      this.#onTurn?.(failed);
      this.#setState("recoverable-error");
      this.#setState("ready");
      return;
    }
    this.#active = { interactionId, captureId };
    this.#turns.recordCaptureStarted({ interactionId, captureId });
    this.#setState("listening");
  }

  public async finishCapture(): Promise<SemanticTurnResult> {
    if (this.#state !== "listening" || this.#active === undefined) {
      throw new VoiceAudioStateError("No capture is waiting to finish.");
    }
    const active = this.#active;
    this.#active = undefined;
    let audio;
    try {
      audio = await this.#capture.stop(active.captureId);
    } catch {
      this.#turns.recordCaptureEnded({
        interactionId: active.interactionId,
        captureId: active.captureId,
        durationMs: 0,
        outcome: "failed",
      });
      const failed = this.#turns.recordTranscriptionFailure({
        interactionId: active.interactionId,
        code: "capture-failed",
      });
      this.#onTurn?.(failed);
      this.#setState("recoverable-error");
      this.#setState("ready");
      return failed;
    }
    this.#turns.recordCaptureEnded({
      interactionId: active.interactionId,
      captureId: active.captureId,
      durationMs: audio.durationMs,
      outcome: "submitted",
    });
    this.#setState("processing");
    const turnAbort = new AbortController();
    this.#turnAbort = turnAbort;

    let result: SemanticTurnResult;
    try {
      const transcript = await this.#transcriber.transcribe(
        audio,
        turnAbort.signal,
      );
      result = await this.#turns.submitTurn(
        {
          interactionId: active.interactionId,
          transcript: transcript.text,
          transcriptConfidence: transcript.confidence,
          observedObjects: this.#observedObjects(),
        },
        turnAbort.signal,
      );
    } catch (error) {
      if (turnAbort.signal.aborted) {
        result = this.#turns.recordTranscriptionFailure({
          interactionId: active.interactionId,
          code: "cancelled",
        });
      } else {
        const code =
          error instanceof ScriptedAudioError
            ? error.code
            : "transcription-failed";
        result = this.#turns.recordTranscriptionFailure({
          interactionId: active.interactionId,
          code,
        });
        this.#setState("recoverable-error");
      }
    } finally {
      this.#turnAbort = undefined;
    }

    this.#onTurn?.(result);
    const prepared = this.#narration.takePrepared(active.interactionId);
    for (const request of prepared) {
      await this.#play(request);
    }
    if (!this.#isPaused()) this.#setState("ready");
    return result;
  }

  public async stop(): Promise<void> {
    this.#turnAbort?.abort(new Error("Player stopped the active turn."));
    this.#playbackAbort?.abort(new Error("Player stopped playback."));
    await this.#playback.stop();
    if (this.#state !== "paused" && this.#active === undefined) {
      this.#setState("ready");
    }
  }

  public async pause(): Promise<void> {
    if (this.#state === "paused") return;
    const active = this.#active;
    if (active !== undefined) {
      await this.#capture.cancel(active.captureId);
      this.#turns.recordCaptureEnded({
        interactionId: active.interactionId,
        captureId: active.captureId,
        durationMs: 0,
        outcome: "cancelled",
      });
      this.#active = undefined;
    }
    await this.stop();
    this.#turns.recordPaused(active?.interactionId ?? "session-control");
    this.#setState("paused");
  }

  public async resume(): Promise<void> {
    if (this.#state !== "paused") return;
    this.#turns.recordResumed("session-control");
    this.#setState("ready");
  }

  public async repeat(): Promise<void> {
    if (this.#state !== "ready" || this.#lastPlayed === undefined) return;
    await this.#play(this.#lastPlayed);
    this.#setState("ready");
  }

  public async submitText(text: string): Promise<SemanticTurnResult> {
    if (this.#state !== "ready") {
      throw new VoiceAudioStateError(
        `Cannot submit text while ${this.#state}.`,
      );
    }
    const interactionId = this.#boundedId(
      this.#nextInteractionId(),
      "interaction",
    );
    this.#setState("processing");
    const turnAbort = new AbortController();
    this.#turnAbort = turnAbort;
    let result: SemanticTurnResult;
    try {
      result = await this.#turns.submitTurn(
        {
          interactionId,
          transcript: text,
          transcriptConfidence: 1,
          observedObjects: this.#observedObjects(),
        },
        turnAbort.signal,
      );
    } finally {
      this.#turnAbort = undefined;
    }
    this.#onTurn?.(result);
    for (const request of this.#narration.takePrepared(interactionId)) {
      await this.#play(request);
    }
    if (!this.#isPaused()) this.#setState("ready");
    return result;
  }

  async #play(request: NarrationRequest): Promise<void> {
    const controller = new AbortController();
    this.#playbackAbort = controller;
    this.#setState(
      request.role === "guide" ? "guide-speaking" : "narrator-speaking",
    );
    this.#turns.recordPlaybackStarted({
      interactionId: request.correlationId,
      narrationId: request.narrationId,
      role: request.role,
      sourceEventId: request.sourceEventId,
    });
    try {
      await this.#playback.play(request, controller.signal);
      this.#lastPlayed = { ...request };
      this.#turns.recordPlaybackEnded({
        interactionId: request.correlationId,
        narrationId: request.narrationId,
        role: request.role,
        sourceEventId: request.sourceEventId,
        outcome: "complete",
      });
    } catch {
      this.#turns.recordPlaybackEnded({
        interactionId: request.correlationId,
        narrationId: request.narrationId,
        role: request.role,
        sourceEventId: request.sourceEventId,
        outcome: controller.signal.aborted ? "interrupted" : "failed",
      });
      if (!controller.signal.aborted) this.#setState("recoverable-error");
    } finally {
      if (this.#playbackAbort === controller) this.#playbackAbort = undefined;
    }
  }

  #setState(state: VoiceAudioState): void {
    this.#state = state;
    this.#onState?.(state);
  }

  #isPaused(): boolean {
    return this.#state === "paused";
  }

  #boundedId(value: string, kind: string): string {
    if (value.length === 0 || value.length > 160 || /\p{Cc}/u.test(value)) {
      throw new TypeError(`${kind} id must be a bounded nonempty string.`);
    }
    return value;
  }
}
