import type {
  CapturePort,
  CapturedAudioTurn,
  FinalTranscript,
  PlaybackLifecycle,
  PlaybackPort,
  TranscriberPort,
} from "../../../packages/audio/src/index.js";
import type {
  GuideModel,
  InitialGuideModelInput,
} from "../../../packages/guide-core/src/index.js";
import type { NarrationRequest } from "../../../packages/session/src/index.js";

const SESSION_HEADER = "x-zork-voice-live-session";
const TRANSCRIBE_PATH = "/api/live/openai/transcribe";
const GUIDE_PATH = "/api/live/openai/guide";
const SPEECH_PATH = "/api/live/openai/speech";

const DEFAULT_MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_JSON_BYTES = 16 * 1024;
const DEFAULT_MAX_SPEECH_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_DURATION_MS = 15_000;
const DEFAULT_DATA_TIMESLICE_MS = 250;
const DEFAULT_PLAYBACK_ACTIVATION_TIMEOUT_MS = 1_500;
const DEFAULT_PLAYBACK_START_TIMEOUT_MS = 5_000;
const MAX_TRANSCRIPT_CHARACTERS = 2_000;
const MAX_NARRATION_CHARACTERS = 4_000;
const MAX_FAILURE_RESPONSE_BYTES = 1_024;

const captureMediaTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

export type OpenAiLiveAudioErrorCode =
  | "aborted"
  | "budget-exhausted"
  | "capture-busy"
  | "capture-empty"
  | "capture-mismatch"
  | "capture-too-large"
  | "invalid-input"
  | "malformed-response"
  | "playback-authorization-required"
  | "playback-busy"
  | "playback-failed"
  | "provider-rejected"
  | "session-expired"
  | "transport-failed";

export class OpenAiLiveAudioError extends Error {
  public constructor(
    public readonly code: OpenAiLiveAudioErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OpenAiLiveAudioError";
  }
}

export interface CapturedAudioBlobStore {
  put(clipId: string, blob: Blob): void;
  take(clipId: string): Blob;
  discard(clipId: string): void;
}

export interface InMemoryCapturedAudioStoreOptions {
  readonly maxAudioBytes?: number;
  readonly maxEntries?: number;
}

export class InMemoryCapturedAudioStore implements CapturedAudioBlobStore {
  readonly #blobs = new Map<string, Blob>();
  readonly #maxAudioBytes: number;
  readonly #maxEntries: number;

  public constructor(options: InMemoryCapturedAudioStoreOptions = {}) {
    this.#maxAudioBytes = boundedInteger(
      options.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES,
      "maximum audio bytes",
      1,
      DEFAULT_MAX_AUDIO_BYTES,
    );
    this.#maxEntries = boundedInteger(
      options.maxEntries ?? 1,
      "maximum audio entries",
      1,
      8,
    );
  }

  public get size(): number {
    return this.#blobs.size;
  }

  public has(clipId: string): boolean {
    return this.#blobs.has(boundedId(clipId, "clip"));
  }

  public put(clipId: string, blob: Blob): void {
    const id = boundedId(clipId, "clip");
    if (!(blob instanceof Blob) || blob.size === 0) {
      throw new OpenAiLiveAudioError(
        "capture-empty",
        "Captured audio was empty.",
      );
    }
    if (blob.size > this.#maxAudioBytes) {
      throw new OpenAiLiveAudioError(
        "capture-too-large",
        "Captured audio exceeded the configured limit.",
      );
    }
    normalizedAudioMediaType(blob.type);
    if (!this.#blobs.has(id) && this.#blobs.size >= this.#maxEntries) {
      throw new OpenAiLiveAudioError(
        "capture-busy",
        "The one-shot audio store is full.",
      );
    }
    this.#blobs.set(id, blob);
  }

  public take(clipId: string): Blob {
    const id = boundedId(clipId, "clip");
    const blob = this.#blobs.get(id);
    this.#blobs.delete(id);
    if (blob === undefined) {
      throw new OpenAiLiveAudioError(
        "capture-mismatch",
        "Captured audio was unavailable.",
      );
    }
    return blob;
  }

  public discard(clipId: string): void {
    this.#blobs.delete(boundedId(clipId, "clip"));
  }
}

export interface LiveMediaTrack {
  stop(): void;
}

export interface LiveMediaStream {
  getTracks(): readonly LiveMediaTrack[];
}

export interface LiveMediaDevices {
  getUserMedia(constraints: {
    readonly audio: true;
    readonly video: false;
  }): Promise<LiveMediaStream>;
}

export interface LiveRecorderHandlers {
  readonly data: (blob: Blob) => void;
  readonly error: () => void;
  readonly stop: () => void;
}

export interface LiveMediaRecorder {
  readonly mimeType: string;
  readonly state: "inactive" | "paused" | "recording";
  setHandlers(handlers: LiveRecorderHandlers): void;
  clearHandlers(): void;
  start(timesliceMs: number): void;
  stop(): void;
}

export interface LiveMediaRecorderOptions {
  readonly mimeType: string;
  readonly audioBitsPerSecond: number;
}

export type LiveMediaRecorderFactory = (
  stream: LiveMediaStream,
  options: LiveMediaRecorderOptions,
) => LiveMediaRecorder;

type ScheduledHandle = unknown;

export interface BrowserMicrophoneCapturePortOptions {
  readonly store: CapturedAudioBlobStore;
  readonly mediaDevices?: LiveMediaDevices;
  readonly createRecorder?: LiveMediaRecorderFactory;
  readonly supportsMediaType?: (mediaType: string) => boolean;
  readonly now?: () => number;
  readonly schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ScheduledHandle;
  readonly cancelScheduled?: (handle: ScheduledHandle) => void;
  readonly maxDurationMs?: number;
  readonly maxAudioBytes?: number;
  readonly dataTimesliceMs?: number;
}

interface ActiveCapture {
  readonly captureId: string;
  readonly stream: LiveMediaStream;
  readonly recorder: LiveMediaRecorder;
  readonly startedAtMs: number;
  readonly chunks: Blob[];
  readonly completion: Promise<CapturedAudioTurn>;
  resolve: (turn: CapturedAudioTurn) => void;
  reject: (error: unknown) => void;
  totalBytes: number;
  scheduled: ScheduledHandle | undefined;
  failure: OpenAiLiveAudioError | undefined;
  cancelled: boolean;
  settled: boolean;
}

interface StartingCapture {
  readonly captureId: string;
  cancelled: boolean;
}

class NativeLiveMediaRecorder implements LiveMediaRecorder {
  readonly #recorder: MediaRecorder;
  readonly #fallbackMediaType: string;
  #handlers: LiveRecorderHandlers | undefined;

  public constructor(
    stream: LiveMediaStream,
    options: LiveMediaRecorderOptions,
  ) {
    this.#fallbackMediaType = options.mimeType;
    this.#recorder = new MediaRecorder(stream as MediaStream, options);
    this.#recorder.addEventListener("dataavailable", (event) => {
      this.#handlers?.data(event.data);
    });
    this.#recorder.addEventListener("error", () => {
      this.#handlers?.error();
    });
    this.#recorder.addEventListener("stop", () => {
      this.#handlers?.stop();
    });
  }

  public get mimeType(): string {
    return this.#recorder.mimeType || this.#fallbackMediaType;
  }

  public get state(): "inactive" | "paused" | "recording" {
    return this.#recorder.state;
  }

  public setHandlers(handlers: LiveRecorderHandlers): void {
    this.#handlers = handlers;
  }

  public clearHandlers(): void {
    this.#handlers = undefined;
  }

  public start(timesliceMs: number): void {
    this.#recorder.start(timesliceMs);
  }

  public stop(): void {
    this.#recorder.stop();
  }
}

export class BrowserMicrophoneCapturePort implements CapturePort {
  readonly #store: CapturedAudioBlobStore;
  readonly #mediaDevices: LiveMediaDevices;
  readonly #createRecorder: LiveMediaRecorderFactory;
  readonly #supportsMediaType: (mediaType: string) => boolean;
  readonly #now: () => number;
  readonly #schedule: (
    callback: () => void,
    delayMs: number,
  ) => ScheduledHandle;
  readonly #cancelScheduled: (handle: ScheduledHandle) => void;
  readonly #maxDurationMs: number;
  readonly #maxAudioBytes: number;
  readonly #dataTimesliceMs: number;
  #active: ActiveCapture | undefined;
  #starting: StartingCapture | undefined;

  public constructor(options: BrowserMicrophoneCapturePortOptions) {
    this.#store = options.store;
    this.#mediaDevices =
      options.mediaDevices ??
      (navigator.mediaDevices as unknown as LiveMediaDevices);
    this.#createRecorder =
      options.createRecorder ??
      ((stream, recorderOptions) =>
        new NativeLiveMediaRecorder(stream, recorderOptions));
    this.#supportsMediaType =
      options.supportsMediaType ??
      ((mediaType) => MediaRecorder.isTypeSupported(mediaType));
    this.#now = options.now ?? (() => performance.now());
    this.#schedule =
      options.schedule ??
      ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.#cancelScheduled =
      options.cancelScheduled ??
      ((handle) => globalThis.clearTimeout(handle as number));
    this.#maxDurationMs = boundedInteger(
      options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
      "maximum capture duration",
      250,
      60_000,
    );
    this.#maxAudioBytes = boundedInteger(
      options.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES,
      "maximum capture bytes",
      1,
      DEFAULT_MAX_AUDIO_BYTES,
    );
    this.#dataTimesliceMs = boundedInteger(
      options.dataTimesliceMs ?? DEFAULT_DATA_TIMESLICE_MS,
      "capture timeslice",
      50,
      1_000,
    );
  }

  public async start(captureId: string): Promise<void> {
    const id = boundedId(captureId, "capture");
    if (this.#active !== undefined || this.#starting !== undefined) {
      throw new OpenAiLiveAudioError(
        "capture-busy",
        "Another microphone capture is active.",
      );
    }
    const starting: StartingCapture = { captureId: id, cancelled: false };
    this.#starting = starting;

    let stream: LiveMediaStream;
    try {
      stream = await this.#mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    } catch (error) {
      if (this.#starting === starting) this.#starting = undefined;
      if (starting.cancelled) {
        throw new OpenAiLiveAudioError(
          "aborted",
          "Microphone capture was cancelled before it started.",
          { cause: error },
        );
      }
      throw new OpenAiLiveAudioError(
        "transport-failed",
        "Microphone access failed.",
        { cause: error },
      );
    }

    if (starting.cancelled || this.#starting !== starting) {
      stopTracks(stream);
      throw new OpenAiLiveAudioError(
        "aborted",
        "Microphone capture was cancelled before it started.",
      );
    }
    this.#starting = undefined;

    try {
      const mediaType = captureMediaTypes.find((candidate) =>
        this.#supportsMediaType(candidate),
      );
      if (mediaType === undefined) {
        throw new OpenAiLiveAudioError(
          "invalid-input",
          "This browser has no supported microphone recording format.",
        );
      }
      const recorder = this.#createRecorder(stream, {
        mimeType: mediaType,
        audioBitsPerSecond: 96_000,
      });
      let resolve!: (turn: CapturedAudioTurn) => void;
      let reject!: (error: unknown) => void;
      const completion = new Promise<CapturedAudioTurn>((accept, decline) => {
        resolve = accept;
        reject = decline;
      });
      void completion.catch(() => undefined);
      const active: ActiveCapture = {
        captureId: id,
        stream,
        recorder,
        startedAtMs: this.#now(),
        chunks: [],
        completion,
        resolve,
        reject,
        totalBytes: 0,
        scheduled: undefined,
        failure: undefined,
        cancelled: false,
        settled: false,
      };
      recorder.setHandlers({
        data: (blob) => this.#recordChunk(active, blob),
        error: () => this.#failCapture(active, "Microphone recording failed."),
        stop: () => this.#finalizeCapture(active),
      });
      this.#active = active;
      recorder.start(this.#dataTimesliceMs);
      active.scheduled = this.#schedule(() => {
        this.#stopRecorder(active);
      }, this.#maxDurationMs);
    } catch (error) {
      const active = this.#active;
      if (active?.captureId === id) {
        active.recorder.clearHandlers();
        if (active.recorder.state !== "inactive") {
          try {
            active.recorder.stop();
          } catch {
            // The stream is stopped below even if the recorder cannot stop.
          }
        }
        active.settled = true;
        active.reject(error);
      }
      stopTracks(stream);
      if (this.#active?.captureId === id) this.#active = undefined;
      throw error;
    }
  }

  public async stop(captureId: string): Promise<CapturedAudioTurn> {
    const active = this.#requireActive(captureId);
    this.#stopRecorder(active);
    try {
      return await active.completion;
    } finally {
      if (this.#active === active) this.#active = undefined;
    }
  }

  public async cancel(captureId: string): Promise<void> {
    const id = boundedId(captureId, "capture");
    const starting = this.#starting;
    if (starting?.captureId === id) {
      starting.cancelled = true;
      this.#starting = undefined;
      return;
    }
    const active = this.#requireActive(captureId);
    active.cancelled = true;
    this.#store.discard(active.captureId);
    this.#stopRecorder(active);
    // Cancellation owns the host boundary: do not wait for a recorder that may
    // never dispatch its stop event before releasing the microphone tracks.
    this.#finalizeCapture(active);
    try {
      await active.completion;
    } catch {
      // Cancellation intentionally discards the one-shot capture.
    } finally {
      if (this.#active === active) this.#active = undefined;
    }
  }

  #requireActive(captureId: string): ActiveCapture {
    const id = boundedId(captureId, "capture");
    if (this.#active?.captureId !== id) {
      throw new OpenAiLiveAudioError(
        "capture-mismatch",
        "The capture id does not match the active microphone turn.",
      );
    }
    return this.#active;
  }

  #recordChunk(active: ActiveCapture, blob: Blob): void {
    if (active.settled || active.cancelled || blob.size === 0) return;
    active.totalBytes += blob.size;
    if (active.totalBytes > this.#maxAudioBytes) {
      active.failure = new OpenAiLiveAudioError(
        "capture-too-large",
        "Captured audio exceeded the configured limit.",
      );
      active.chunks.length = 0;
      this.#stopRecorder(active);
      return;
    }
    active.chunks.push(blob);
  }

  #failCapture(active: ActiveCapture, message: string): void {
    if (active.settled) return;
    active.failure = new OpenAiLiveAudioError("transport-failed", message);
    if (active.recorder.state === "inactive") {
      this.#finalizeCapture(active);
    } else {
      this.#stopRecorder(active);
    }
  }

  #stopRecorder(active: ActiveCapture): void {
    if (active.settled || active.recorder.state === "inactive") return;
    try {
      active.recorder.stop();
    } catch {
      active.failure ??= new OpenAiLiveAudioError(
        "transport-failed",
        "Microphone recording could not stop safely.",
      );
      this.#finalizeCapture(active);
    }
  }

  #finalizeCapture(active: ActiveCapture): void {
    if (active.settled) return;
    active.settled = true;
    if (active.scheduled !== undefined) {
      this.#cancelScheduled(active.scheduled);
      active.scheduled = undefined;
    }
    active.recorder.clearHandlers();
    stopTracks(active.stream);

    if (active.cancelled) {
      active.reject(
        new OpenAiLiveAudioError(
          "aborted",
          "Microphone capture was cancelled.",
        ),
      );
      return;
    }
    if (active.failure !== undefined) {
      active.reject(active.failure);
      return;
    }

    const mediaType = normalizedAudioMediaType(active.recorder.mimeType);
    const blob = new Blob(active.chunks, { type: mediaType });
    active.chunks.length = 0;
    if (blob.size === 0) {
      active.reject(
        new OpenAiLiveAudioError("capture-empty", "Captured audio was empty."),
      );
      return;
    }
    try {
      this.#store.put(active.captureId, blob);
      active.resolve({
        clipId: active.captureId,
        durationMs: Math.min(
          this.#maxDurationMs,
          Math.max(0, Math.round(this.#now() - active.startedAtMs)),
        ),
      });
    } catch (error) {
      active.reject(error);
    }
  }
}

export interface OpenAiLiveTranscriberOptions {
  readonly sessionToken: string;
  readonly store: CapturedAudioBlobStore;
  readonly fetch?: typeof fetch;
  readonly maxAudioBytes?: number;
  readonly maxResponseBytes?: number;
}

export class OpenAiLiveTranscriber implements TranscriberPort {
  readonly #sessionToken: string;
  readonly #store: CapturedAudioBlobStore;
  readonly #fetch: typeof fetch;
  readonly #maxAudioBytes: number;
  readonly #maxResponseBytes: number;

  public constructor(options: OpenAiLiveTranscriberOptions) {
    this.#sessionToken = boundedSessionToken(options.sessionToken);
    this.#store = options.store;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maxAudioBytes = boundedInteger(
      options.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES,
      "maximum transcription audio bytes",
      1,
      DEFAULT_MAX_AUDIO_BYTES,
    );
    this.#maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_JSON_BYTES,
      "maximum transcription response bytes",
      1,
      DEFAULT_MAX_JSON_BYTES,
    );
  }

  public async transcribe(
    audio: CapturedAudioTurn,
    signal: AbortSignal,
  ): Promise<FinalTranscript> {
    boundedId(audio.clipId, "clip");
    if (
      !Number.isFinite(audio.durationMs) ||
      audio.durationMs < 0 ||
      audio.durationMs > 60_000
    ) {
      throw new OpenAiLiveAudioError(
        "invalid-input",
        "Captured audio duration was invalid.",
      );
    }

    const blob = this.#store.take(audio.clipId);
    if (blob.size === 0 || blob.size > this.#maxAudioBytes) {
      throw new OpenAiLiveAudioError(
        blob.size === 0 ? "capture-empty" : "capture-too-large",
        "Captured audio could not be transcribed safely.",
      );
    }
    const mediaType = normalizedAudioMediaType(blob.type);
    const response = await safeFetch(
      this.#fetch,
      TRANSCRIBE_PATH,
      {
        method: "POST",
        headers: liveHeaders(this.#sessionToken, mediaType),
        body: blob,
      },
      signal,
    );
    const envelope = await readJsonObject(response, this.#maxResponseBytes);
    return {
      text: boundedText(
        envelope.text,
        "transcription",
        MAX_TRANSCRIPT_CHARACTERS,
        false,
      ),
    };
  }
}

export interface OpenAiLiveGuideModelOptions {
  readonly sessionToken: string;
  readonly fetch?: typeof fetch;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
}

export class OpenAiLiveGuideModel implements GuideModel {
  readonly #sessionToken: string;
  readonly #fetch: typeof fetch;
  readonly #maxRequestBytes: number;
  readonly #maxResponseBytes: number;

  public constructor(options: OpenAiLiveGuideModelOptions) {
    this.#sessionToken = boundedSessionToken(options.sessionToken);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maxRequestBytes = boundedInteger(
      options.maxRequestBytes ?? DEFAULT_MAX_JSON_BYTES,
      "maximum guide request bytes",
      1,
      DEFAULT_MAX_JSON_BYTES,
    );
    this.#maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_JSON_BYTES,
      "maximum guide response bytes",
      1,
      DEFAULT_MAX_JSON_BYTES,
    );
  }

  public async decide(
    input: InitialGuideModelInput,
    signal: AbortSignal,
  ): Promise<unknown> {
    const confidence = input.transcriptConfidence;
    if (
      confidence !== undefined &&
      (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    ) {
      throw new OpenAiLiveAudioError(
        "invalid-input",
        "Transcript confidence was invalid.",
      );
    }
    if (
      !Array.isArray(input.observedObjects) ||
      input.observedObjects.length > 64
    ) {
      throw new OpenAiLiveAudioError(
        "invalid-input",
        "Observed objects exceeded the guide boundary.",
      );
    }
    const body = encodeJson(
      {
        interactionId: boundedId(input.interactionId, "interaction"),
        playerUtterance: boundedText(
          input.playerUtterance,
          "player utterance",
          MAX_TRANSCRIPT_CHARACTERS,
          false,
        ),
        ...(confidence === undefined
          ? {}
          : { transcriptConfidence: confidence }),
        observedObjects: input.observedObjects.map((object) =>
          boundedText(object, "observed object", 160, false),
        ),
        ...(input.pendingIntent === undefined
          ? {}
          : { pendingIntent: input.pendingIntent }),
      },
      this.#maxRequestBytes,
    );
    const response = await safeFetch(
      this.#fetch,
      GUIDE_PATH,
      {
        method: "POST",
        headers: liveHeaders(this.#sessionToken, "application/json"),
        body,
      },
      signal,
    );
    const envelope = await readJsonObject(response, this.#maxResponseBytes);
    if (!Object.hasOwn(envelope, "decision")) {
      throw new OpenAiLiveAudioError(
        "malformed-response",
        "The guide response omitted its decision.",
      );
    }
    return envelope.decision;
  }
}

export interface LiveAudioElement {
  src: string;
  play(): Promise<void>;
  pause(): void;
  addEventListener(
    type: "playing" | "ended" | "error",
    listener: () => void,
    options?: { readonly once?: boolean },
  ): void;
  removeEventListener(
    type: "playing" | "ended" | "error",
    listener: () => void,
  ): void;
}

export interface OpenAiLivePlaybackPortOptions {
  readonly sessionToken: string;
  readonly fetch?: typeof fetch;
  readonly createAudio?: () => LiveAudioElement;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
  readonly schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ScheduledHandle;
  readonly cancelScheduled?: (handle: ScheduledHandle) => void;
  readonly activationTimeoutMs?: number;
  readonly playbackStartTimeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
}

interface ActivePlayback {
  readonly abort: AbortController;
  objectUrl: string | undefined;
}

type PlaybackActivationState =
  | { readonly phase: "idle" }
  | {
      readonly phase: "pending";
      readonly promise: Promise<PlaybackActivationResult>;
      readonly cancel: () => void;
    }
  | {
      readonly phase: "settled";
      readonly result: PlaybackActivationResult;
    };

type PlaybackActivationResult = "authorized" | "denied";

// A short unmuted, zero-amplitude PCM clip gives WebKit enough media duration
// to reach its playing boundary. It is local-only activation material, never
// provider input or a narration lifecycle event.
const PLAYBACK_ACTIVATION_WAV = createSilentPcmWav(8_000, 250);

export class OpenAiLivePlaybackPort implements PlaybackPort {
  readonly #sessionToken: string;
  readonly #fetch: typeof fetch;
  readonly #audio: LiveAudioElement;
  readonly #createObjectUrl: (blob: Blob) => string;
  readonly #revokeObjectUrl: (url: string) => void;
  readonly #schedule: (
    callback: () => void,
    delayMs: number,
  ) => ScheduledHandle;
  readonly #cancelScheduled: (handle: ScheduledHandle) => void;
  readonly #activationTimeoutMs: number;
  readonly #playbackStartTimeoutMs: number;
  readonly #maxRequestBytes: number;
  readonly #maxResponseBytes: number;
  #activation: PlaybackActivationState = { phase: "idle" };
  #activationObjectUrl: string | undefined;
  #active: ActivePlayback | undefined;

  public constructor(options: OpenAiLivePlaybackPortOptions) {
    this.#sessionToken = boundedSessionToken(options.sessionToken);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#audio = options.createAudio?.() ?? (new Audio() as LiveAudioElement);
    this.#createObjectUrl =
      options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.#revokeObjectUrl =
      options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
    this.#schedule =
      options.schedule ??
      ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.#cancelScheduled =
      options.cancelScheduled ??
      ((handle) => globalThis.clearTimeout(handle as number));
    this.#activationTimeoutMs = boundedInteger(
      options.activationTimeoutMs ?? DEFAULT_PLAYBACK_ACTIVATION_TIMEOUT_MS,
      "playback activation timeout",
      50,
      10_000,
    );
    this.#playbackStartTimeoutMs = boundedInteger(
      options.playbackStartTimeoutMs ?? DEFAULT_PLAYBACK_START_TIMEOUT_MS,
      "playback start timeout",
      250,
      30_000,
    );
    this.#maxRequestBytes = boundedInteger(
      options.maxRequestBytes ?? DEFAULT_MAX_JSON_BYTES,
      "maximum speech request bytes",
      1,
      DEFAULT_MAX_JSON_BYTES,
    );
    this.#maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_SPEECH_BYTES,
      "maximum speech response bytes",
      1,
      DEFAULT_MAX_SPEECH_BYTES,
    );
  }

  /**
   * Must be invoked directly from an audio-related player gesture. The method
   * intentionally returns before its play promise settles so the browser sees
   * the media start in the activation call stack.
   */
  public activateFromUserGesture(): void {
    if (
      this.#active !== undefined ||
      this.#activation.phase === "pending" ||
      (this.#activation.phase === "settled" &&
        this.#activation.result === "authorized")
    ) {
      return;
    }

    this.#discardActivationObjectUrl();
    let objectUrl: string | undefined;
    let playPromise: Promise<void>;
    try {
      objectUrl = this.#createObjectUrl(
        new Blob([PLAYBACK_ACTIVATION_WAV.slice().buffer], {
          type: "audio/wav",
        }),
      );
      this.#activationObjectUrl = objectUrl;
      this.#audio.src = objectUrl;
      playPromise = this.#audio.play();
    } catch {
      if (objectUrl !== undefined) {
        try {
          this.#revokeObjectUrl(objectUrl);
        } catch {
          // Activation must remain non-throwing even if browser cleanup fails.
        }
      }
      if (this.#activationObjectUrl === objectUrl) {
        this.#activationObjectUrl = undefined;
      }
      this.#activation = { phase: "settled", result: "denied" };
      return;
    }

    const attempt = boundedPlaybackActivation(
      playPromise,
      this.#activationTimeoutMs,
      this.#schedule,
      this.#cancelScheduled,
    );
    const activationPromise: Promise<PlaybackActivationResult> =
      attempt.promise.then((result) => {
        if (
          this.#activation.phase === "pending" &&
          this.#activation.promise === activationPromise
        ) {
          this.#activation = { phase: "settled", result };
          this.#discardActivationObjectUrl();
        }
        return result;
      });
    this.#activation = {
      phase: "pending",
      promise: activationPromise,
      cancel: attempt.cancel,
    };
  }

  public async play(
    request: NarrationRequest,
    signal: AbortSignal,
    lifecycle: PlaybackLifecycle,
  ): Promise<void> {
    if (this.#active !== undefined) {
      throw new OpenAiLiveAudioError(
        "playback-busy",
        "Another narration request is active.",
      );
    }
    if (request.role !== "guide" && request.role !== "narrator") {
      throw new OpenAiLiveAudioError(
        "invalid-input",
        "Narration role was invalid.",
      );
    }
    boundedId(request.narrationId, "narration");
    boundedId(request.correlationId, "correlation");
    boundedId(request.sourceEventId, "source event");
    const body = encodeJson(
      {
        text: boundedText(
          request.text,
          "narration text",
          MAX_NARRATION_CHARACTERS,
          true,
        ),
        role: request.role,
      },
      this.#maxRequestBytes,
    );
    const active: ActivePlayback = {
      abort: new AbortController(),
      objectUrl: undefined,
    };
    this.#active = active;
    const abort = () => active.abort.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();

    try {
      const activation = this.#activation;
      if (
        activation.phase === "idle" ||
        (activation.phase === "settled" && activation.result !== "authorized")
      ) {
        throw new OpenAiLiveAudioError(
          "playback-authorization-required",
          "Audio playback requires a player gesture.",
        );
      }
      const response = await safeFetch(
        this.#fetch,
        SPEECH_PATH,
        {
          method: "POST",
          headers: liveHeaders(this.#sessionToken, "application/json"),
          body,
        },
        active.abort.signal,
      );
      const mediaType = response.headers.get("content-type")?.split(";", 1)[0];
      if (mediaType === undefined || !mediaType.startsWith("audio/")) {
        throw new OpenAiLiveAudioError(
          "malformed-response",
          "The speech response did not contain audio.",
        );
      }
      const bytes = await readBoundedBody(response, this.#maxResponseBytes);
      const objectUrl = this.#createObjectUrl(
        new Blob([bytes.buffer], { type: mediaType }),
      );
      active.objectUrl = objectUrl;
      this.#audio.pause();
      this.#audio.src = objectUrl;
      this.#discardActivationObjectUrl();
      try {
        await playUntilEnded(
          this.#audio,
          active.abort.signal,
          {
            onStarted: () => {
              this.#markPlaybackAuthorized();
              lifecycle.onStarted();
            },
          },
          this.#playbackStartTimeoutMs,
          this.#schedule,
          this.#cancelScheduled,
        );
      } catch (error) {
        if (
          error instanceof OpenAiLiveAudioError &&
          error.code === "playback-authorization-required"
        ) {
          this.#activation = { phase: "idle" };
        }
        throw error;
      }
    } finally {
      signal.removeEventListener("abort", abort);
      this.#disposePlayback(active);
      if (this.#active === active) this.#active = undefined;
    }
  }

  public async stop(): Promise<void> {
    const activation = this.#activation;
    if (activation.phase === "pending") {
      this.#activation = { phase: "idle" };
      activation.cancel();
      this.#discardActivationObjectUrl();
    }
    const active = this.#active;
    if (active === undefined) return;
    active.abort.abort(
      new OpenAiLiveAudioError("aborted", "Narration playback was stopped."),
    );
    this.#disposePlayback(active);
  }

  #disposePlayback(active: ActivePlayback): void {
    if (active.objectUrl !== undefined) {
      this.#audio.pause();
      this.#revokeObjectUrl(active.objectUrl);
      active.objectUrl = undefined;
    }
  }

  #discardActivationObjectUrl(): void {
    const objectUrl = this.#activationObjectUrl;
    if (objectUrl === undefined) return;
    this.#activationObjectUrl = undefined;
    try {
      if (this.#audio.src === objectUrl) {
        this.#audio.pause();
      }
    } catch {
      // Revocation below still releases the local activation blob when possible.
    }
    try {
      this.#revokeObjectUrl(objectUrl);
    } catch {
      // Gesture activation is non-throwing by contract.
    }
  }

  #markPlaybackAuthorized(): void {
    const activation = this.#activation;
    this.#activation = { phase: "settled", result: "authorized" };
    if (activation.phase === "pending") activation.cancel();
    this.#discardActivationObjectUrl();
  }
}

function createSilentPcmWav(
  sampleRate: number,
  durationMs: number,
): Uint8Array {
  const sampleCount = Math.round((sampleRate * durationMs) / 1_000);
  const dataBytes = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

interface BoundedPlaybackActivation {
  readonly promise: Promise<PlaybackActivationResult>;
  readonly cancel: () => void;
}

function boundedPlaybackActivation(
  playPromise: Promise<void>,
  timeoutMs: number,
  schedule: (callback: () => void, delayMs: number) => ScheduledHandle,
  cancelScheduled: (handle: ScheduledHandle) => void,
): BoundedPlaybackActivation {
  let finish: (result: PlaybackActivationResult) => void = () => undefined;
  const promise = new Promise<PlaybackActivationResult>((resolve) => {
    let settled = false;
    let scheduled: ScheduledHandle | undefined;
    finish = (result: PlaybackActivationResult) => {
      if (settled) return;
      settled = true;
      if (scheduled !== undefined) {
        try {
          cancelScheduled(scheduled);
        } catch {
          // Activation settlement must remain non-throwing.
        }
        scheduled = undefined;
      }
      resolve(result);
    };
    try {
      scheduled = schedule(() => {
        scheduled = undefined;
        finish("denied");
      }, timeoutMs);
    } catch {
      void playPromise.catch(() => undefined);
      finish("denied");
      return;
    }
    if (settled && scheduled !== undefined) {
      try {
        cancelScheduled(scheduled);
      } catch {
        // Activation settlement must remain non-throwing.
      }
      scheduled = undefined;
    }
    playPromise.then(
      () => finish("authorized"),
      () => finish("denied"),
    );
  });
  return { promise, cancel: () => finish("denied") };
}

function boundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new OpenAiLiveAudioError(
      "invalid-input",
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function boundedId(value: unknown, name: string): string {
  return boundedText(value, `${name} id`, 160, false);
}

function boundedSessionToken(value: unknown): string {
  const token = boundedText(value, "live session token", 160, false);
  if (token.length < 32) {
    throw new OpenAiLiveAudioError(
      "invalid-input",
      "The live session token was invalid.",
    );
  }
  return token;
}

function boundedText(
  value: unknown,
  name: string,
  maximum: number,
  allowNarrationWhitespace: boolean,
): string {
  const invalidControl =
    typeof value === "string" &&
    [...value.matchAll(/\p{Cc}/gu)].some(
      ([control]) =>
        !allowNarrationWhitespace ||
        (control !== "\t" && control !== "\n" && control !== "\r"),
    );
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    invalidControl
  ) {
    throw new OpenAiLiveAudioError(
      "invalid-input",
      `${name} must be a bounded nonempty string.`,
    );
  }
  return value;
}

function normalizedAudioMediaType(value: string): string {
  const base = value.toLocaleLowerCase("en-US").split(";", 1)[0];
  if (base !== "audio/webm" && base !== "audio/mp4" && base !== "audio/ogg") {
    throw new OpenAiLiveAudioError(
      "invalid-input",
      "Captured audio used an unsupported media type.",
    );
  }
  return value;
}

function stopTracks(stream: LiveMediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function liveHeaders(sessionToken: string, contentType: string): Headers {
  return new Headers({
    "content-type": contentType,
    [SESSION_HEADER]: sessionToken,
  });
}

function encodeJson(value: unknown, maximum: number): string {
  const serialized = JSON.stringify(value);
  const bytes = new TextEncoder().encode(serialized);
  if (bytes.byteLength === 0 || bytes.byteLength > maximum) {
    throw new OpenAiLiveAudioError(
      "invalid-input",
      "The live provider request exceeded its configured limit.",
    );
  }
  return serialized;
}

async function safeFetch(
  fetchImplementation: typeof fetch,
  path: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetchImplementation(path, {
      ...init,
      signal,
      cache: "no-store",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "same-origin",
    });
  } catch (error) {
    if (signal.aborted) {
      throw (
        signal.reason ??
        new OpenAiLiveAudioError("aborted", "The live request was cancelled.")
      );
    }
    throw new OpenAiLiveAudioError(
      "transport-failed",
      "The live provider request failed.",
      { cause: error },
    );
  }
  if (!response.ok) {
    const code = await readLiveFailureCode(response);
    throw new OpenAiLiveAudioError(
      code,
      `The live provider request was rejected with status ${response.status}.`,
    );
  }
  return response;
}

async function readLiveFailureCode(
  response: Response,
): Promise<OpenAiLiveAudioErrorCode> {
  try {
    const envelope = await readJsonObject(response, MAX_FAILURE_RESPONSE_BYTES);
    const failure = envelope.error;
    if (
      typeof failure !== "object" ||
      failure === null ||
      Array.isArray(failure)
    ) {
      return "provider-rejected";
    }
    const code = Reflect.get(failure, "code");
    switch (code) {
      case "aborted":
      case "budget-exhausted":
      case "invalid-input":
      case "malformed-response":
      case "provider-rejected":
      case "transport-failed":
        return code;
      case "forbidden":
        return "session-expired";
      case "request-too-large":
        return "capture-too-large";
      case "invalid-request":
      case "unsupported-audio":
        return "invalid-input";
      default:
        return "provider-rejected";
    }
  } catch {
    await response.body?.cancel().catch(() => undefined);
    return "provider-rejected";
  }
}

async function readBoundedBody(
  response: Response,
  maximum: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declaredValue = response.headers.get("content-length");
  if (declaredValue !== null) {
    const declared = Number(declaredValue);
    if (
      !Number.isSafeInteger(declared) ||
      declared <= 0 ||
      declared > maximum
    ) {
      throw new OpenAiLiveAudioError(
        "malformed-response",
        "The live provider response size was invalid.",
      );
    }
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new OpenAiLiveAudioError(
      "malformed-response",
      "The live provider response body was missing.",
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maximum) {
      await reader.cancel().catch(() => undefined);
      throw new OpenAiLiveAudioError(
        "malformed-response",
        "The live provider response exceeded its configured limit.",
      );
    }
    chunks.push(new Uint8Array(result.value));
  }
  if (total === 0) {
    throw new OpenAiLiveAudioError(
      "malformed-response",
      "The live provider response was empty.",
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readJsonObject(
  response: Response,
  maximum: number,
): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  if (contentType !== "application/json") {
    throw new OpenAiLiveAudioError(
      "malformed-response",
      "The live provider response was not JSON.",
    );
  }
  const bytes = await readBoundedBody(response, maximum);
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch (error) {
    throw new OpenAiLiveAudioError(
      "malformed-response",
      "The live provider response was malformed.",
      { cause: error },
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OpenAiLiveAudioError(
      "malformed-response",
      "The live provider response was not an object.",
    );
  }
  return value as Record<string, unknown>;
}

function playbackFailure(error?: unknown): OpenAiLiveAudioError {
  let name: unknown;
  try {
    name =
      typeof error === "object" && error !== null
        ? Reflect.get(error, "name")
        : undefined;
  } catch {
    name = undefined;
  }
  return name === "NotAllowedError"
    ? new OpenAiLiveAudioError(
        "playback-authorization-required",
        "Audio playback requires a player gesture.",
      )
    : new OpenAiLiveAudioError("playback-failed", "Narration playback failed.");
}

async function playUntilEnded(
  audio: LiveAudioElement,
  signal: AbortSignal,
  lifecycle: PlaybackLifecycle,
  startTimeoutMs: number,
  schedule: (callback: () => void, delayMs: number) => ScheduledHandle,
  cancelScheduled: (handle: ScheduledHandle) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let started = false;
    let settled = false;
    let startDeadline: ScheduledHandle | undefined;
    const cancelStartDeadline = () => {
      if (startDeadline === undefined) return;
      try {
        cancelScheduled(startDeadline);
      } catch {
        // Playback cleanup must not replace the actual terminal outcome.
      }
      startDeadline = undefined;
    };
    const cleanup = () => {
      cancelStartDeadline();
      audio.removeEventListener("playing", playing);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const playing = () => {
      if (started || settled) return;
      started = true;
      cancelStartDeadline();
      try {
        lifecycle.onStarted();
      } catch (error) {
        settled = true;
        cleanup();
        reject(error);
      }
    };
    const ended = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!started) {
        reject(
          new OpenAiLiveAudioError(
            "playback-failed",
            "Narration ended before audible playback began.",
          ),
        );
        return;
      }
      resolve();
    };
    const failed = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(playbackFailure(error));
    };
    const aborted = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        signal.reason ??
          new OpenAiLiveAudioError(
            "aborted",
            "Narration playback was stopped.",
          ),
      );
    };
    audio.addEventListener("playing", playing, { once: true });
    audio.addEventListener("ended", ended, { once: true });
    audio.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) {
      aborted();
      return;
    }
    try {
      startDeadline = schedule(() => {
        startDeadline = undefined;
        if (started || settled) return;
        settled = true;
        cleanup();
        reject(
          new OpenAiLiveAudioError(
            "playback-authorization-required",
            "Audio playback did not begin after the player gesture.",
          ),
        );
      }, startTimeoutMs);
    } catch (error) {
      failed(error);
      return;
    }
    if (settled) cancelStartDeadline();
    try {
      void audio.play().catch(failed);
    } catch (error) {
      failed(error);
    }
  });
}
