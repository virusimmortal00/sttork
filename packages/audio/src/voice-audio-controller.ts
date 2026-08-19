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
import { transcriptionFailureCode } from "./contracts.js";
import type { ScriptedNarrationPort } from "./scripted-audio.js";

export type VoiceAudioState =
  | "ready"
  | "requesting-microphone"
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
    | {
        readonly interactionId: string;
        readonly captureId: string;
        captureStarted: boolean;
      }
    | undefined;
  #lifecycleEpoch = 0;
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
    if (this.#state !== "ready" && this.#state !== "recoverable-error") {
      throw new VoiceAudioStateError(
        `Cannot start capture while ${this.#state}.`,
      );
    }
    const interactionId = this.#boundedId(
      this.#nextInteractionId(),
      "interaction",
    );
    const captureId = this.#boundedId(this.#nextCaptureId(), "capture");
    const active = { interactionId, captureId, captureStarted: false };
    const lifecycleEpoch = this.#lifecycleEpoch;
    this.#active = active;
    this.#setState("requesting-microphone");
    try {
      await this.#capture.start(captureId);
    } catch {
      if (this.#active !== active || this.#lifecycleEpoch !== lifecycleEpoch) {
        return;
      }
      this.#active = undefined;
      const failed = this.#turns.recordAudioFailure({
        interactionId,
        code: "microphone-unavailable",
      });
      this.#onTurn?.(failed);
      this.#setState("recoverable-error");
      return;
    }
    if (this.#active !== active || this.#lifecycleEpoch !== lifecycleEpoch) {
      await this.#capture.cancel(captureId).catch(() => undefined);
      return;
    }
    active.captureStarted = true;
    this.#turns.recordCaptureStarted({ interactionId, captureId });
    this.#setState("listening");
  }

  public async finishCapture(): Promise<SemanticTurnResult> {
    if (this.#state !== "listening" || this.#active === undefined) {
      throw new VoiceAudioStateError("No capture is waiting to finish.");
    }
    const active = this.#active;
    const lifecycleEpoch = this.#lifecycleEpoch;
    this.#setState("processing");
    let audio;
    try {
      audio = await this.#capture.stop(active.captureId);
    } catch {
      if (this.#active !== active || this.#lifecycleEpoch !== lifecycleEpoch) {
        return this.#recordCancelledTurn(active.interactionId);
      }
      this.#active = undefined;
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
      return failed;
    }
    if (this.#active !== active || this.#lifecycleEpoch !== lifecycleEpoch) {
      return this.#recordCancelledTurn(active.interactionId);
    }
    this.#active = undefined;
    this.#turns.recordCaptureEnded({
      interactionId: active.interactionId,
      captureId: active.captureId,
      durationMs: audio.durationMs,
      outcome: "submitted",
    });
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
          ...(transcript.confidence === undefined
            ? {}
            : { transcriptConfidence: transcript.confidence }),
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
        const code = transcriptionFailureCode(error) ?? "transcription-failed";
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
    const playbackEpoch = this.#lifecycleEpoch;
    for (const request of prepared) {
      if (
        this.#lifecycleEpoch !== playbackEpoch ||
        this.#isPaused() ||
        this.#isRecoverableError()
      ) {
        break;
      }
      await this.#play(request);
    }
    if (!this.#isPaused() && !this.#isRecoverableError()) {
      this.#setState("ready");
    }
    return result;
  }

  public async stop(): Promise<void> {
    this.#lifecycleEpoch += 1;
    this.#turnAbort?.abort(new Error("Player stopped the active turn."));
    this.#playbackAbort?.abort(new Error("Player stopped playback."));
    const active = this.#active;
    this.#active = undefined;
    if (active !== undefined) {
      let captureOutcome: "cancelled" | "failed" = "cancelled";
      try {
        await this.#capture.cancel(active.captureId);
      } catch {
        captureOutcome = "failed";
        const failed = this.#turns.recordAudioFailure({
          interactionId: active.interactionId,
          code: "capture-cancel-failed",
        });
        this.#onTurn?.(failed);
        this.#setState("recoverable-error");
      }
      if (active.captureStarted) {
        this.#turns.recordCaptureEnded({
          interactionId: active.interactionId,
          captureId: active.captureId,
          durationMs: 0,
          outcome: captureOutcome,
        });
      }
    }
    await this.#playback.stop();
    if (!this.#isPaused() && !this.#isRecoverableError()) {
      this.#setState("ready");
    }
  }

  public async pause(): Promise<void> {
    if (this.#state === "paused") return;
    const active = this.#active;
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
    if (
      (this.#state !== "ready" && this.#state !== "recoverable-error") ||
      this.#lastPlayed === undefined
    ) {
      return;
    }
    await this.#play(this.#lastPlayed);
    if (!this.#isRecoverableError()) this.#setState("ready");
  }

  public async submitText(text: string): Promise<SemanticTurnResult> {
    if (this.#state !== "ready" && this.#state !== "recoverable-error") {
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
    const playbackEpoch = this.#lifecycleEpoch;
    for (const request of this.#narration.takePrepared(interactionId)) {
      if (
        this.#lifecycleEpoch !== playbackEpoch ||
        this.#isPaused() ||
        this.#isRecoverableError()
      ) {
        break;
      }
      await this.#play(request);
    }
    if (!this.#isPaused() && !this.#isRecoverableError()) {
      this.#setState("ready");
    }
    return result;
  }

  async #play(request: NarrationRequest): Promise<void> {
    const controller = new AbortController();
    this.#playbackAbort = controller;
    if (this.#state !== "processing") this.#setState("processing");
    let started = false;
    const onStarted = () => {
      if (started || controller.signal.aborted) return;
      started = true;
      this.#setState(
        request.role === "guide" ? "guide-speaking" : "narrator-speaking",
      );
      this.#turns.recordPlaybackStarted({
        interactionId: request.correlationId,
        narrationId: request.narrationId,
        role: request.role,
        sourceEventId: request.sourceEventId,
      });
    };
    this.#lastPlayed = { ...request };
    try {
      await this.#playback.play(request, controller.signal, { onStarted });
      if (!started) {
        throw new VoiceAudioStateError(
          "Playback completed without reaching its audible start boundary.",
        );
      }
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

  #recordCancelledTurn(interactionId: string): SemanticTurnResult {
    const result = this.#turns.recordTranscriptionFailure({
      interactionId,
      code: "cancelled",
    });
    this.#onTurn?.(result);
    if (!this.#isPaused()) this.#setState("ready");
    return result;
  }

  #setState(state: VoiceAudioState): void {
    this.#state = state;
    this.#onState?.(state);
  }

  #isPaused(): boolean {
    return this.#state === "paused";
  }

  #isRecoverableError(): boolean {
    return this.#state === "recoverable-error";
  }

  #boundedId(value: string, kind: string): string {
    if (value.length === 0 || value.length > 160 || /\p{Cc}/u.test(value)) {
      throw new TypeError(`${kind} id must be a bounded nonempty string.`);
    }
    return value;
  }
}
