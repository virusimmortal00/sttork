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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
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
  public readonly play = vi.fn(async () => undefined);
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
          language: "en",
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
      command: "north",
      affordanceId: "grammar.direction.north",
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
    const audios: FakeAudioElement[] = [];
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
      createAudio: () => {
        const audio = new FakeAudioElement();
        audios.push(audio);
        return audio;
      },
    });

    const guide = playback.play(
      narration("guide", "Guide response."),
      new AbortController().signal,
      { onStarted: () => startedRoles.push("guide") },
    );
    await vi.waitFor(() => expect(audios[0]?.play).toHaveBeenCalledOnce());
    expect(startedRoles).toEqual([]);
    audios[0]?.start();
    audios[0]?.start();
    expect(startedRoles).toEqual(["guide"]);
    audios[0]?.end();
    await guide;

    const narrator = playback.play(
      narration("narrator", "Exact line one.\nExact line two."),
      new AbortController().signal,
      { onStarted: () => startedRoles.push("narrator") },
    );
    await vi.waitFor(() => expect(audios[1]?.play).toHaveBeenCalledOnce());
    expect(startedRoles).toEqual(["guide"]);
    audios[1]?.start();
    audios[1]?.end();
    await narrator;
    expect(startedRoles).toEqual(["guide", "narrator"]);

    expect(bodies).toEqual([
      { text: "Guide response.", role: "guide" },
      { text: "Exact line one.\nExact line two.", role: "narrator" },
    ]);
    expect(createdBlobs.map((blob) => [blob.size, blob.type])).toEqual([
      [3, "audio/mpeg"],
      [3, "audio/mpeg"],
    ]);
    expect(revoked).toEqual(["blob:voice-1", "blob:voice-2"]);
  });

  it("aborts active playback, pauses audio, and revokes its object URL", async () => {
    const audio = new FakeAudioElement();
    const revoked = vi.fn();
    const playback = new OpenAiLivePlaybackPort({
      sessionToken,
      fetch: vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            headers: { "content-type": "audio/mpeg" },
          }),
      ),
      createObjectUrl: () => "blob:interrupt",
      revokeObjectUrl: revoked,
      createAudio: () => audio,
    });
    const onStarted = vi.fn();
    const playing = playback.play(
      narration("narrator"),
      new AbortController().signal,
      { onStarted },
    );
    const rejected = expect(playing).rejects.toBeInstanceOf(Error);
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledOnce());

    await playback.stop();
    await rejected;

    expect(audio.pause).toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
    expect(revoked).toHaveBeenCalledOnce();
    expect(revoked).toHaveBeenCalledWith("blob:interrupt");
  });

  it("rejects oversized speech before allocating an object URL", async () => {
    const createObjectUrl = vi.fn(() => "blob:oversized");
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
    const onStarted = vi.fn();

    await expect(
      playback.play(narration("guide"), new AbortController().signal, {
        onStarted,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "malformed-response" }));
    expect(createObjectUrl).not.toHaveBeenCalled();
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
