import {
  createOpenAiLiveService,
  type OpenAiLiveProviderPort,
} from "@zork-voice/server";
import type {
  GuideDecisionWithUsage,
  ProviderSpeech,
  ProviderTranscription,
} from "@zork-voice/providers";
import { ProviderAdapterError } from "@zork-voice/providers";
import { describe, expect, it, vi } from "vitest";

const origin = "http://127.0.0.1:4319";
const token = "local-session-token-12345678901234567890";

class FakeProvider implements OpenAiLiveProviderPort {
  public readonly transcribe = vi.fn(
    async (
      ...args: Parameters<OpenAiLiveProviderPort["transcribe"]>
    ): Promise<ProviderTranscription> => {
      void args;
      return {
        text: "go north",
        language: "en",
        usage: {
          provider: "openai",
          capability: "transcription",
          model: "transcriber-test",
          inputAudioBytes: 3,
        },
      };
    },
  );
  public readonly decideWithUsage = vi.fn(
    async (
      ...args: Parameters<OpenAiLiveProviderPort["decideWithUsage"]>
    ): Promise<GuideDecisionWithUsage> => {
      void args;
      return {
        decision: {
          kind: "execute",
          command: "north",
          intentSummary: "Move north",
          confidence: 0.98,
        },
        usage: {
          provider: "openai",
          capability: "guide",
          model: "guide-test",
          totalTokens: 40,
        },
      };
    },
  );
  public readonly synthesize = vi.fn(
    async (
      ...args: Parameters<OpenAiLiveProviderPort["synthesize"]>
    ): Promise<ProviderSpeech> => {
      void args;
      return {
        bytes: new Uint8Array([7, 8, 9]),
        mediaType: "audio/mpeg",
        usage: {
          provider: "openai",
          capability: "narration",
          model: "speech-test",
          inputCharacters: 12,
        },
      };
    },
  );
}

function request(
  path: string,
  body: BodyInit,
  contentType: string,
  extraHeaders: HeadersInit = {},
): Request {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      origin,
      "content-type": contentType,
      "x-zork-voice-live-session": token,
      ...extraHeaders,
    },
    body,
  });
}

describe("OpenAI local live service", () => {
  it("rejects cross-origin or unauthenticated requests before provider work", async () => {
    const provider = new FakeProvider();
    const handle = createOpenAiLiveService({
      provider,
      allowedOrigin: origin,
      sessionToken: token,
    });

    const response = await handle(
      new Request(`${origin}/api/live/openai/guide`, {
        method: "POST",
        headers: { origin: "http://attacker.invalid" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "forbidden" } });
    expect(provider.transcribe).not.toHaveBeenCalled();
    expect(provider.decideWithUsage).not.toHaveBeenCalled();
    expect(provider.synthesize).not.toHaveBeenCalled();
  });

  it("accepts an exact HTTPS proxy origin without weakening Origin checks", async () => {
    const provider = new FakeProvider();
    const publicOrigin = "https://voice.home.example:8443";
    const handle = createOpenAiLiveService({
      provider,
      allowedOrigin: publicOrigin,
      sessionToken: token,
    });
    const body = JSON.stringify({
      interactionId: "proxied-live-1",
      playerUtterance: "north",
      observedObjects: [],
    });

    const accepted = await handle(
      new Request(`${publicOrigin}/api/live/openai/guide`, {
        method: "POST",
        headers: {
          origin: publicOrigin,
          "content-type": "application/json",
          "x-zork-voice-live-session": token,
        },
        body,
      }),
    );
    expect(accepted.status).toBe(200);
    expect(provider.decideWithUsage).toHaveBeenCalledTimes(1);

    const wrongOrigin = await handle(
      new Request(`${publicOrigin}/api/live/openai/guide`, {
        method: "POST",
        headers: {
          origin: "https://other.home.example:8443",
          "content-type": "application/json",
          "x-zork-voice-live-session": token,
        },
        body,
      }),
    );
    expect(wrongOrigin.status).toBe(403);
    expect(provider.decideWithUsage).toHaveBeenCalledTimes(1);
  });

  it.each([
    "http://192.168.1.25:4175",
    "https://*.home.example",
    "https://voice.home.example/",
    "https://voice.home.example/path",
    "https://voice.home.example?mode=live",
    "https://voice.home.example#live",
    "https://player@voice.home.example",
  ])("rejects an unsafe service origin: %s", (allowedOrigin) => {
    expect(() =>
      createOpenAiLiveService({
        provider: new FakeProvider(),
        allowedOrigin,
        sessionToken: token,
      }),
    ).toThrow("exact loopback HTTP or HTTPS origin");
  });

  it("bounds and normalizes live transcription", async () => {
    const provider = new FakeProvider();
    const handle = createOpenAiLiveService({
      provider,
      allowedOrigin: origin,
      sessionToken: token,
    });

    const response = await handle(
      request(
        "/api/live/openai/transcribe",
        new Uint8Array([1, 2, 3]),
        "audio/webm;codecs=opus",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      text: "go north",
      language: "en",
      usage: expect.objectContaining({
        capability: "transcription",
        inputAudioBytes: 3,
      }),
    });
    expect(provider.transcribe).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "audio/webm",
      expect.any(AbortSignal),
    );
  });

  it("regenerates reviewed command knowledge and validates the guide response", async () => {
    const provider = new FakeProvider();
    const handle = createOpenAiLiveService({
      provider,
      allowedOrigin: origin,
      sessionToken: token,
    });

    const response = await handle(
      request(
        "/api/live/openai/guide",
        JSON.stringify({
          interactionId: "live-1",
          playerUtterance: "please head north",
          transcriptConfidence: 0.97,
          observedObjects: ["token"],
          ignoredKnowledge: { hiddenMap: true },
        }),
        "application/json",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      decision: {
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.98,
      },
      usage: expect.objectContaining({ capability: "guide", totalTokens: 40 }),
    });
    expect(provider.decideWithUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionId: "live-1",
        observedObjects: ["token"],
        knowledge: expect.objectContaining({ observedObjects: ["token"] }),
      }),
      expect.any(AbortSignal),
    );
    expect(
      JSON.stringify(provider.decideWithUsage.mock.calls[0]?.[0]),
    ).not.toContain("hiddenMap");
  });

  it("returns role-specific speech bytes without exposing provider objects", async () => {
    const provider = new FakeProvider();
    const handle = createOpenAiLiveService({
      provider,
      allowedOrigin: origin,
      sessionToken: token,
    });

    const response = await handle(
      request(
        "/api/live/openai/speech",
        JSON.stringify({ text: "Exact prose.", role: "narrator" }),
        "application/json",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("x-zork-voice-model")).toBe("speech-test");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      7, 8, 9,
    ]);
    expect(provider.synthesize).toHaveBeenCalledWith(
      "Exact prose.",
      "narrator",
      expect.any(AbortSignal),
    );
  });

  it("preserves exact multiline engine prose at the speech boundary", async () => {
    const provider = new FakeProvider();
    const handle = createOpenAiLiveService({
      provider,
      allowedOrigin: origin,
      sessionToken: token,
    });
    const exact = "West of House\n\nYou are standing beside a house.\t> ";

    const response = await handle(
      request(
        "/api/live/openai/speech",
        JSON.stringify({ text: exact, role: "narrator" }),
        "application/json",
      ),
    );

    expect(response.status).toBe(200);
    expect(provider.synthesize).toHaveBeenCalledWith(
      exact,
      "narrator",
      expect.any(AbortSignal),
    );
  });

  it("rejects C1 controls before the narration provider boundary", async () => {
    const provider = new FakeProvider();
    const handle = createOpenAiLiveService({
      provider,
      allowedOrigin: origin,
      sessionToken: token,
    });

    const response = await handle(
      request(
        "/api/live/openai/speech",
        JSON.stringify({ text: "unsafe\u0085prose", role: "narrator" }),
        "application/json",
      ),
    );

    expect(response.status).toBe(400);
    expect(provider.synthesize).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies without reading or forwarding them", async () => {
    const provider = new FakeProvider();
    const handle = createOpenAiLiveService({
      provider,
      allowedOrigin: origin,
      sessionToken: token,
    });
    const response = await handle(
      request(
        "/api/live/openai/transcribe",
        new Uint8Array([1]),
        "audio/webm",
        { "content-length": String(2 * 1024 * 1024 + 1) },
      ),
    );

    expect(response.status).toBe(413);
    expect(provider.transcribe).not.toHaveBeenCalled();
  });

  it("normalizes provider and malformed-decision failures", async () => {
    const provider = new FakeProvider();
    provider.decideWithUsage.mockRejectedValueOnce(
      new ProviderAdapterError("budget-exhausted", "sensitive detail"),
    );
    const handle = createOpenAiLiveService({
      provider,
      allowedOrigin: origin,
      sessionToken: token,
    });
    const guideRequest = () =>
      request(
        "/api/live/openai/guide",
        JSON.stringify({
          interactionId: "live-failure",
          playerUtterance: "north",
          observedObjects: [],
        }),
        "application/json",
      );

    const budget = await handle(guideRequest());
    expect(budget.status).toBe(429);
    expect(await budget.text()).toBe(
      JSON.stringify({ error: { code: "budget-exhausted" } }),
    );

    provider.decideWithUsage.mockResolvedValueOnce({
      decision: { kind: "execute", command: "north", extra: "unsafe" },
      usage: {
        provider: "openai",
        capability: "guide",
        model: "guide-test",
      },
    });
    const malformed = await handle(guideRequest());
    expect(malformed.status).toBe(502);
    expect(await malformed.json()).toEqual({
      error: { code: "malformed-response" },
    });
  });
});
