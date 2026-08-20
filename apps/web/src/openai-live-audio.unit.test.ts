import { createOpeningCommandKnowledge } from "../../../packages/command-knowledge/src/index.js";
import type { NarrationRequest } from "../../../packages/session/src/index.js";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserMicrophoneCapturePort,
  InMemoryCapturedAudioStore,
  OpenAiLiveAudioError,
  OpenAiLiveGuideModel,
  OpenAiLivePlaybackPort,
  OpenAiLiveTranscriber,
  type LiveAudioElement,
  type LiveMediaRecorder,
  type LiveMediaRecorderOptions,
  type LiveMediaStream,
  type LiveRecorderHandlers,
} from "./openai-live-audio.js";

const sessionToken = "live-session-token-12345678901234567890";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

class FakeRecorder implements LiveMediaRecorder {
  public state: "inactive" | "paused" | "recording" = "inactive";
  public readonly mimeType: string;
  public readonly starts: number[] = [];
  #handlers: LiveRecorderHandlers | undefined;

  public constructor(options: LiveMediaRecorderOptions) {
    this.mimeType = options.mimeType;
  }

  public setHandlers(handlers: LiveRecorderHandlers): void {
    this.#handlers = handlers;
  }

  public clearHandlers(): void {
    this.#handlers = undefined;
  }

  public start(timesliceMs: number): void {
    this.starts.push(timesliceMs);
    this.state = "recording";
  }

  public stop(): void {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.#handlers?.stop();
  }

  public emit(bytes: readonly number[]): void {
    this.#handlers?.data(
      new Blob([new Uint8Array(bytes).buffer], { type: this.mimeType }),
    );
  }
}

class DelayedStopRecorder extends FakeRecorder {
  public override stop(): void {
    if (this.state === "inactive") return;
    this.state = "inactive";
  }
}

class FakeAudioElement implements LiveAudioElement {
  public src = "";
  public readonly play = vi.fn(async (): Promise<void> => undefined);
  public readonly pause = vi.fn();
  readonly #listeners = new Map<
    "playing" | "ended" | "error",
    Set<() => void>
  >();

  public addEventListener(
    type: "playing" | "ended" | "error",
    listener: () => void,
  ): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  public removeEventListener(
    type: "playing" | "ended" | "error",
    listener: () => void,
  ): void {
    this.#listeners.get(type)?.delete(listener);
  }

  public start(): void {
    for (const listener of this.#listeners.get("playing") ?? []) listener();
  }

  public end(): void {
    for (const listener of this.#listeners.get("ended") ?? []) listener();
  }
}

function narration(
  role: NarrationRequest["role"],
  text = "Exact game prose.",
): NarrationRequest {
  return {
    narrationId: `narration-${role}`,
    role,
    text,
    sourceEventId: `source-${role}`,
    correlationId: `interaction-${role}`,
  };
}

describe("InMemoryCapturedAudioStore", () => {
  it("removes raw audio on its first take and enforces its byte bound", () => {
    const store = new InMemoryCapturedAudioStore({ maxAudioBytes: 3 });
    const blob = new Blob([new Uint8Array([1, 2, 3]).buffer], {
      type: "audio/webm",
    });

    store.put("clip-1", blob);
    expect(store.has("clip-1")).toBe(true);
    expect(store.take("clip-1")).toBe(blob);
    expect(store.size).toBe(0);
    expect(() => store.take("clip-1")).toThrowError(
      expect.objectContaining({ code: "capture-mismatch" }),
    );
    expect(() =>
      store.put(
        "clip-2",
        new Blob([new Uint8Array([1, 2, 3, 4]).buffer], {
          type: "audio/webm",
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "capture-too-large" }));
  });
});

describe("BrowserMicrophoneCapturePort", () => {
  it("reserves the capture slot while microphone permission is pending", async () => {
    const store = new InMemoryCapturedAudioStore();
    let grantPermission!: (stream: LiveMediaStream) => void;
    const permission = new Promise<LiveMediaStream>((resolve) => {
      grantPermission = resolve;
    });
    const capture = new BrowserMicrophoneCapturePort({
      store,
      mediaDevices: { getUserMedia: async () => permission },
      supportsMediaType: (mediaType) => mediaType === "audio/webm",
      createRecorder: (_stream, options) => new FakeRecorder(options),
      schedule: () => "timer",
      cancelScheduled: () => undefined,
    });

    const first = capture.start("capture-pending");
    await expect(capture.start("capture-racing")).rejects.toEqual(
      expect.objectContaining({ code: "capture-busy" }),
    );
    grantPermission({ getTracks: () => [{ stop: vi.fn() }] });
    await first;
    await capture.cancel("capture-pending");
  });

  it("cancels a pending permission request and stops a late stream", async () => {
    const store = new InMemoryCapturedAudioStore();
    const stopTrack = vi.fn();
    let grantPermission!: (stream: LiveMediaStream) => void;
    const permission = new Promise<LiveMediaStream>((resolve) => {
      grantPermission = resolve;
    });
    const capture = new BrowserMicrophoneCapturePort({
      store,
      mediaDevices: { getUserMedia: async () => permission },
      supportsMediaType: (mediaType) => mediaType === "audio/webm",
      createRecorder: (_stream, options) => new FakeRecorder(options),
      schedule: () => "timer",
      cancelScheduled: () => undefined,
    });

    const starting = capture.start("capture-cancelled-pending");
    await capture.cancel("capture-cancelled-pending");
    grantPermission({ getTracks: () => [{ stop: stopTrack }] });

    await expect(starting).rejects.toEqual(
      expect.objectContaining({ code: "aborted" }),
    );
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(store.size).toBe(0);
  });

  it("captures one bounded clip, stops every track, and honors the hard timer", async () => {
    const store = new InMemoryCapturedAudioStore();
    const stopTrack = vi.fn();
    const stream: LiveMediaStream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    let recorder: FakeRecorder | undefined;
    let hardStop: (() => void) | undefined;
    const cancelScheduled = vi.fn();
    let now = 100;
    const capture = new BrowserMicrophoneCapturePort({
      store,
      mediaDevices: {
        getUserMedia: async () => stream,
      },
      supportsMediaType: (mediaType) => mediaType === "audio/webm",
      createRecorder: (_stream, options) => {
        recorder = new FakeRecorder(options);
        return recorder;
      },
      now: () => now,
      schedule: (callback, delayMs) => {
        expect(delayMs).toBe(1_000);
        hardStop = callback;
        return "hard-stop";
      },
      cancelScheduled,
      maxDurationMs: 1_000,
    });

    await capture.start("capture-1");
    expect(recorder?.starts).toEqual([250]);
    recorder?.emit([1, 2, 3]);
    now = 1_500;
    hardStop?.();

    await expect(capture.stop("capture-1")).resolves.toEqual({
      clipId: "capture-1",
      durationMs: 1_000,
    });
    expect(store.has("capture-1")).toBe(true);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(cancelScheduled).toHaveBeenCalledWith("hard-stop");
  });

  it("discards cancellation and rejects clips that cross the byte ceiling", async () => {
    const store = new InMemoryCapturedAudioStore({ maxAudioBytes: 4 });
    const recorders: FakeRecorder[] = [];
    const capture = new BrowserMicrophoneCapturePort({
      store,
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }),
      },
      supportsMediaType: (mediaType) => mediaType === "audio/webm",
      createRecorder: (_stream, options) => {
        const recorder = new FakeRecorder(options);
        recorders.push(recorder);
        return recorder;
      },
      schedule: () => "timer",
      cancelScheduled: () => undefined,
      maxAudioBytes: 4,
    });

    await capture.start("cancelled");
    recorders[0]?.emit([1, 2]);
    await capture.cancel("cancelled");
    expect(store.has("cancelled")).toBe(false);

    await capture.start("oversized");
    recorders[1]?.emit([1, 2, 3, 4, 5]);
    await expect(capture.stop("oversized")).rejects.toEqual(
      expect.objectContaining({ code: "capture-too-large" }),
    );
    expect(store.has("oversized")).toBe(false);
  });

  it("releases microphone tracks even when the recorder omits its stop event", async () => {
    const store = new InMemoryCapturedAudioStore();
    const stopTrack = vi.fn();
    const capture = new BrowserMicrophoneCapturePort({
      store,
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: stopTrack }],
        }),
      },
      supportsMediaType: (mediaType) => mediaType === "audio/webm",
      createRecorder: (_stream, options) => new DelayedStopRecorder(options),
      schedule: () => "timer",
      cancelScheduled: () => undefined,
    });

    await capture.start("delayed-recorder-stop");
    await capture.cancel("delayed-recorder-stop");

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(store.size).toBe(0);
  });
});

describe("OpenAiLiveTranscriber", () => {
  it("takes raw audio before a same-origin BFF request and returns no invented confidence", async () => {
    const store = new InMemoryCapturedAudioStore();
    store.put(
      "clip-1",
      new Blob([new Uint8Array([1, 2, 3]).buffer], {
        type: "audio/webm;codecs=opus",
      }),
    );
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(store.size).toBe(0);
        expect(input).toBe("/api/live/openai/transcribe");
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: expect.any(Blob),
            cache: "no-store",
            credentials: "same-origin",
            mode: "same-origin",
            redirect: "error",
          }),
        );
        const headers = new Headers(init?.headers);
        expect(headers.get("x-zork-voice-live-session")).toBe(sessionToken);
        expect(headers.get("content-type")).toBe("audio/webm;codecs=opus");
        return jsonResponse({
          text: "go north",
          languages: ["en"],
          usage: { provider: "openai" },
        });
      },
    ) as unknown as typeof fetch;
    const transcriber = new OpenAiLiveTranscriber({
      sessionToken,
      store,
      fetch: fetchMock,
    });

    await expect(
      transcriber.transcribe(
        { clipId: "clip-1", durationMs: 800 },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ text: "go north" });
    expect(store.size).toBe(0);
  });

  it("discards one-shot audio even when the BFF rejects it", async () => {
    const store = new InMemoryCapturedAudioStore();
    store.put(
      "clip-failure",
      new Blob([new Uint8Array([1]).buffer], { type: "audio/webm" }),
    );
    const transcriber = new OpenAiLiveTranscriber({
      sessionToken,
      store,
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
    });

    await expect(
      transcriber.transcribe(
        { clipId: "clip-failure", durationMs: 200 },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "provider-rejected" }));
    expect(store.size).toBe(0);
  });

  it("preserves an allowlisted BFF budget failure without reflecting response prose", async () => {
    const store = new InMemoryCapturedAudioStore();
    store.put(
      "clip-budget",
      new Blob([new Uint8Array([1]).buffer], { type: "audio/webm" }),
    );
    const transcriber = new OpenAiLiveTranscriber({
      sessionToken,
      store,
      fetch: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "budget-exhausted",
              message: "sensitive provider response must not escape",
            },
          },
          429,
        ),
      ),
    });

    await expect(
      transcriber.transcribe(
        { clipId: "clip-budget", durationMs: 200 },
        new AbortController().signal,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "budget-exhausted",
        message: expect.not.stringContaining("sensitive provider response"),
      }),
    );
    expect(store.size).toBe(0);
  });

  it("falls back when the BFF error code is not allowlisted", async () => {
    const store = new InMemoryCapturedAudioStore();
    store.put(
      "clip-unknown-failure",
      new Blob([new Uint8Array([1]).buffer], { type: "audio/webm" }),
    );
    const transcriber = new OpenAiLiveTranscriber({
      sessionToken,
      store,
      fetch: vi.fn(async () =>
        jsonResponse({ error: { code: "sk-sensitive-value" } }, 502),
      ),
    });

    await expect(
      transcriber.transcribe(
        { clipId: "clip-unknown-failure", durationMs: 200 },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "provider-rejected" }));
  });

  it("rejects a streamed response that crosses the browser-side cap", async () => {
    const store = new InMemoryCapturedAudioStore();
    store.put(
      "clip-response",
      new Blob([new Uint8Array([1]).buffer], { type: "audio/webm" }),
    );
    const transcriber = new OpenAiLiveTranscriber({
      sessionToken,
      store,
      maxResponseBytes: 8,
      fetch: vi.fn(async () =>
        jsonResponse({ text: "this response is too large" }),
      ),
    });

    await expect(
      transcriber.transcribe(
        { clipId: "clip-response", durationMs: 200 },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "malformed-response" }));
  });
});

describe("OpenAiLiveGuideModel", () => {
  it("sends only player-safe guide context and returns the unknown decision", async () => {
    const decision = {
      kind: "execute",
      affordanceId: "grammar.direction.north",
      slots: [],
      intentSummary: "Move north",
      confidence: 0.98,
    };
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(input).toBe("/api/live/openai/guide");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toEqual({
          interactionId: "interaction-1",
          playerUtterance: "please head north",
          transcriptConfidence: 0.94,
          observedObjects: ["token"],
        });
        expect(body).not.toHaveProperty("knowledge");
        expect(body).not.toHaveProperty("engine");
        return jsonResponse({
          decision,
          usage: { capability: "guide", totalTokens: 10 },
        });
      },
    ) as unknown as typeof fetch;
    const guide = new OpenAiLiveGuideModel({
      sessionToken,
      fetch: fetchMock,
    });

    await expect(
      guide.decide(
        {
          interactionId: "interaction-1",
          playerUtterance: "please head north",
          transcriptConfidence: 0.94,
          observedObjects: ["token"],
          knowledge: createOpeningCommandKnowledge({
            observedObjects: ["token"],
          }),
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual(decision);
  });

  it("bounds request bytes before calling the BFF", async () => {
    const fetchMock = vi.fn();
    const guide = new OpenAiLiveGuideModel({
      sessionToken,
      fetch: fetchMock,
      maxRequestBytes: 64,
    });

    await expect(
      guide.decide(
        {
          interactionId: "interaction-oversized",
          playerUtterance: "north",
          observedObjects: ["token"],
          knowledge: createOpeningCommandKnowledge({ observedObjects: [] }),
        },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "invalid-input" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OpenAiLivePlaybackPort", () => {
  it("keeps guide and narrator roles separate and revokes every audio URL", async () => {
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as unknown);
        return new Response(new Uint8Array([7, 8, 9]), {
          headers: { "content-type": "audio/mpeg" },
        });
      },
    ) as unknown as typeof fetch;
    const audio = new FakeAudioElement();
    const createAudio = vi.fn(() => audio);
    const createdBlobs: Blob[] = [];
    const revoked: string[] = [];
    const startedRoles: string[] = [];
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: fetchMock,
      createObjectUrl: (blob) => {
        createdBlobs.push(blob);
        return `blob:voice-${createdBlobs.length}`;
      },
      revokeObjectUrl: (url) => revoked.push(url),
      createAudio,
    });
    playback.activateFromUserGesture();

    const guide = playback.play(
      narration("guide", "Guide response."),
      new AbortController().signal,
      { onStarted: () => startedRoles.push("guide") },
    );
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
    expect(startedRoles).toEqual([]);
    audio.start();
    audio.start();
    expect(startedRoles).toEqual(["guide"]);
    audio.end();
    await guide;

    const narrator = playback.play(
      narration("narrator", "Exact line one.\nExact line two."),
      new AbortController().signal,
      { onStarted: () => startedRoles.push("narrator") },
    );
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(3));
    expect(startedRoles).toEqual(["guide"]);
    audio.start();
    audio.end();
    await narrator;
    expect(startedRoles).toEqual(["guide", "narrator"]);
    expect(createAudio).toHaveBeenCalledOnce();

    expect(bodies).toEqual([
      { text: "Guide response.", role: "guide" },
      { text: "Exact line one.\nExact line two.", role: "narrator" },
    ]);
    expect(createdBlobs.map((blob) => [blob.size, blob.type])).toEqual([
      [4_044, "audio/wav"],
      [3, "audio/mpeg"],
      [3, "audio/mpeg"],
    ]);
    expect(
      Array.from(
        new Uint8Array(await createdBlobs[0]!.arrayBuffer()).slice(-2),
      ),
    ).toEqual([0, 0]);
    const activationBytes = await createdBlobs[0]!.arrayBuffer();
    const activationView = new DataView(activationBytes);
    expect(new TextDecoder().decode(activationBytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(activationBytes.slice(8, 12))).toBe("WAVE");
    expect(activationView.getUint32(4, true)).toBe(4_036);
    expect(activationView.getUint32(24, true)).toBe(8_000);
    expect(activationView.getUint32(40, true)).toBe(4_000);
    expect(revoked).toEqual(["blob:voice-1", "blob:voice-2", "blob:voice-3"]);
  });

  it("primes synchronously without blocking synthesis on media readiness", async () => {
    let authorize!: () => void;
    const authorization = new Promise<void>((resolve) => {
      authorize = resolve;
    });
    const audio = new FakeAudioElement();
    audio.play.mockImplementationOnce(async () => authorization);
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1]), {
          headers: { "content-type": "audio/mpeg" },
        }),
    );
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: fetchMock,
      createObjectUrl: (blob) => `blob:${blob.type}:${blob.size}`,
      revokeObjectUrl: vi.fn(),
      createAudio: () => audio,
    });

    playback.activateFromUserGesture();
    expect(audio.play).toHaveBeenCalledOnce();

    const playing = playback.play(
      narration("narrator"),
      new AbortController().signal,
      { onStarted: vi.fn() },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    authorize();
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
    audio.start();
    audio.end();
    await expect(playing).resolves.toBeUndefined();
  });

  it("does not gate speech on a never-settling activation promise", async () => {
    const audio = new FakeAudioElement();
    audio.play.mockImplementationOnce(() => new Promise<void>(() => undefined));
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1]), {
          headers: { "content-type": "audio/mpeg" },
        }),
    );
    let activationTimeout: (() => void) | undefined;
    const cancelScheduled = vi.fn();
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: fetchMock,
      createObjectUrl: () => "blob:pending-activation",
      revokeObjectUrl: vi.fn(),
      createAudio: () => audio,
      activationTimeoutMs: 250,
      schedule: (callback, delayMs) => {
        if (delayMs === 250) {
          activationTimeout = callback;
          return "activation-timeout";
        }
        expect(delayMs).toBe(5_000);
        return "playback-start-timeout";
      },
      cancelScheduled,
    });

    playback.activateFromUserGesture();
    const playing = playback.play(
      narration("narrator"),
      new AbortController().signal,
      { onStarted: vi.fn() },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
    audio.start();
    audio.end();
    await expect(playing).resolves.toBeUndefined();

    activationTimeout?.();
    expect(cancelScheduled).toHaveBeenCalledWith("activation-timeout");
  });

  it("times out a pending activation and permits a fresh successful gesture", async () => {
    const audio = new FakeAudioElement();
    audio.play.mockImplementationOnce(() => new Promise<void>(() => undefined));
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1]), {
          headers: { "content-type": "audio/mpeg" },
        }),
    );
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const cancelled: string[] = [];
    let objectUrl = 0;
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: fetchMock,
      createObjectUrl: () => `blob:activation-retry-${++objectUrl}`,
      revokeObjectUrl: vi.fn(),
      createAudio: () => audio,
      activationTimeoutMs: 250,
      playbackStartTimeoutMs: 500,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return `timer-${scheduled.length}`;
      },
      cancelScheduled: (handle) => cancelled.push(String(handle)),
    });

    playback.activateFromUserGesture();
    expect(scheduled[0]?.delayMs).toBe(250);
    scheduled[0]?.callback();
    await Promise.resolve();
    await Promise.resolve();

    await expect(
      playback.play(narration("narrator"), new AbortController().signal, {
        onStarted: vi.fn(),
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "playback-authorization-required" }),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    playback.activateFromUserGesture();
    await vi.waitFor(() => expect(cancelled).toContain("timer-2"));
    const retried = playback.play(
      narration("narrator"),
      new AbortController().signal,
      { onStarted: vi.fn() },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(3));
    audio.start();
    audio.end();
    await expect(retried).resolves.toBeUndefined();
  });

  it("stops and replaces a pending activation without accepting stale settlement", async () => {
    let authorizeStale!: () => void;
    const staleAuthorization = new Promise<void>((resolve) => {
      authorizeStale = resolve;
    });
    const audio = new FakeAudioElement();
    audio.play.mockImplementationOnce(async () => staleAuthorization);
    const revoked = vi.fn();
    const cancelled: string[] = [];
    let timer = 0;
    let objectUrl = 0;
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            headers: { "content-type": "audio/mpeg" },
          }),
      ),
      createObjectUrl: () => `blob:stale-${++objectUrl}`,
      revokeObjectUrl: revoked,
      createAudio: () => audio,
      schedule: () => `timer-${++timer}`,
      cancelScheduled: (handle) => cancelled.push(String(handle)),
    });

    playback.activateFromUserGesture();
    await playback.stop();
    expect(cancelled).toContain("timer-1");
    expect(revoked).toHaveBeenCalledWith("blob:stale-1");

    playback.activateFromUserGesture();
    await vi.waitFor(() => expect(cancelled).toContain("timer-2"));
    authorizeStale();
    await Promise.resolve();
    await Promise.resolve();

    const playing = playback.play(
      narration("narrator"),
      new AbortController().signal,
      { onStarted: vi.fn() },
    );
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(3));
    audio.start();
    audio.end();
    await expect(playing).resolves.toBeUndefined();
  });

  it("bounds synthesized playback that never reaches the playing event", async () => {
    const audio = new FakeAudioElement();
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            headers: { "content-type": "audio/mpeg" },
          }),
      ),
      createObjectUrl: (blob) => `blob:start-timeout-${blob.size}`,
      revokeObjectUrl: vi.fn(),
      createAudio: () => audio,
      activationTimeoutMs: 250,
      playbackStartTimeoutMs: 500,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return `timer-${scheduled.length}`;
      },
      cancelScheduled: vi.fn(),
    });

    playback.activateFromUserGesture();
    await Promise.resolve();
    await Promise.resolve();
    const playing = playback.play(
      narration("narrator"),
      new AbortController().signal,
      { onStarted: vi.fn() },
    );
    await vi.waitFor(() =>
      expect(scheduled.some(({ delayMs }) => delayMs === 500)).toBe(true),
    );
    scheduled.find(({ delayMs }) => delayMs === 500)?.callback();

    await expect(playing).rejects.toEqual(
      expect.objectContaining({ code: "playback-authorization-required" }),
    );
    playback.activateFromUserGesture();
    expect(audio.play).toHaveBeenCalledTimes(3);
  });

  it("classifies denied playback and allows the next gesture to re-prime the same element", async () => {
    const audio = new FakeAudioElement();
    audio.play
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ name: "NotAllowedError" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const createAudio = vi.fn(() => audio);
    let objectUrl = 0;
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            headers: { "content-type": "audio/mpeg" },
          }),
      ),
      createObjectUrl: () => `blob:authorization-${++objectUrl}`,
      revokeObjectUrl: vi.fn(),
      createAudio,
    });
    const firstStarted = vi.fn();

    playback.activateFromUserGesture();
    await expect(
      playback.play(narration("narrator"), new AbortController().signal, {
        onStarted: firstStarted,
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "playback-authorization-required" }),
    );
    expect(firstStarted).not.toHaveBeenCalled();

    playback.activateFromUserGesture();
    expect(audio.play).toHaveBeenCalledTimes(3);
    const retried = playback.play(
      narration("narrator"),
      new AbortController().signal,
      { onStarted: vi.fn() },
    );
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(4));
    audio.start();
    audio.end();
    await expect(retried).resolves.toBeUndefined();
    expect(createAudio).toHaveBeenCalledOnce();
  });

  it("fails closed without throwing from a gesture activation setup error", async () => {
    const fetchMock = vi.fn();
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: fetchMock,
      createObjectUrl: () => {
        throw new Error("object URLs unavailable");
      },
      revokeObjectUrl: vi.fn(),
      createAudio: () => new FakeAudioElement(),
    });

    expect(() => playback.activateFromUserGesture()).not.toThrow();
    await expect(
      playback.play(narration("guide"), new AbortController().signal, {
        onStarted: vi.fn(),
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "playback-authorization-required" }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not throw when the media element rejects activation synchronously", async () => {
    const audio = new FakeAudioElement();
    audio.play.mockImplementationOnce(() => {
      throw new Error("media session unavailable");
    });
    const revoked = vi.fn();
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: vi.fn(),
      createObjectUrl: () => "blob:sync-activation-failure",
      revokeObjectUrl: revoked,
      createAudio: () => audio,
    });

    expect(() => playback.activateFromUserGesture()).not.toThrow();
    expect(revoked).toHaveBeenCalledWith("blob:sync-activation-failure");
  });

  it("consumes a late prime rejection when activation scheduling is unavailable", async () => {
    let rejectPrime!: (reason: unknown) => void;
    const prime = new Promise<void>((_resolve, reject) => {
      rejectPrime = reject;
    });
    const audio = new FakeAudioElement();
    audio.play.mockImplementationOnce(async () => prime);
    const revoked = vi.fn();
    const fetchMock = vi.fn();
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: fetchMock,
      createObjectUrl: () => "blob:scheduler-failure",
      revokeObjectUrl: revoked,
      createAudio: () => audio,
      schedule: () => {
        throw new Error("timer unavailable");
      },
      cancelScheduled: vi.fn(),
    });

    expect(() => playback.activateFromUserGesture()).not.toThrow();
    await vi.waitFor(() =>
      expect(revoked).toHaveBeenCalledWith("blob:scheduler-failure"),
    );
    rejectPrime({ name: "NotAllowedError" });
    await Promise.resolve();

    await expect(
      playback.play(narration("narrator"), new AbortController().signal, {
        onStarted: vi.fn(),
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "playback-authorization-required" }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts active playback, pauses audio, and revokes its object URL", async () => {
    const audio = new FakeAudioElement();
    const revoked = vi.fn();
    let objectUrl = 0;
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            headers: { "content-type": "audio/mpeg" },
          }),
      ),
      createObjectUrl: () => `blob:interrupt-${++objectUrl}`,
      revokeObjectUrl: revoked,
      createAudio: () => audio,
    });
    playback.activateFromUserGesture();
    const onStarted = vi.fn();
    const playing = playback.play(
      narration("narrator"),
      new AbortController().signal,
      { onStarted },
    );
    const rejected = expect(playing).rejects.toBeInstanceOf(Error);
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));

    await playback.stop();
    await rejected;

    expect(audio.pause).toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
    expect(revoked).toHaveBeenCalledTimes(2);
    expect(revoked).toHaveBeenNthCalledWith(1, "blob:interrupt-1");
    expect(revoked).toHaveBeenNthCalledWith(2, "blob:interrupt-2");
  });

  it("rejects oversized speech before allocating a speech object URL", async () => {
    const createObjectUrl = vi.fn(
      (blob: Blob) => `blob:oversized-${blob.size}`,
    );
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      maxResponseBytes: 2,
      fetch: vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "audio/mpeg" },
          }),
      ),
      createObjectUrl,
      revokeObjectUrl: vi.fn(),
      createAudio: () => new FakeAudioElement(),
    });
    playback.activateFromUserGesture();
    const onStarted = vi.fn();

    await expect(
      playback.play(narration("guide"), new AbortController().signal, {
        onStarted,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "malformed-response" }));
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(createObjectUrl.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ size: 4_044, type: "audio/wav" }),
    );
    expect(onStarted).not.toHaveBeenCalled();
  });
});

describe("OpenAiLiveAudioError", () => {
  it("uses bounded stable client error codes", () => {
    expect(new OpenAiLiveAudioError("aborted", "stopped")).toEqual(
      expect.objectContaining({
        name: "OpenAiLiveAudioError",
        code: "aborted",
      }),
    );
  });
});
