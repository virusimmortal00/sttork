import { createOpeningCommandKnowledge } from "@zork-voice/command-knowledge";
import { describe, expect, it, vi } from "vitest";

import type { ProviderAdapterError } from "./contracts.js";
import {
  OPENAI_CHAINED_PROFILE_2026_08_18,
  OpenAiChainedProvider,
} from "./openai-chained.js";

const testKey = ["sk", "test", "123456789012345678901234567890"].join("-");

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function guideInput() {
  return {
    interactionId: "interaction-live",
    playerUtterance: "please head north",
    transcriptConfidence: 0.98,
    observedObjects: ["token"],
    knowledge: createOpeningCommandKnowledge({ observedObjects: ["token"] }),
  };
}

describe("OpenAiChainedProvider", () => {
  it("normalizes transcription and reports bounded usage", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchStub: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse({
        text: "go north",
        language: "en",
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      });
    };
    const usage = vi.fn();
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: fetchStub,
      onUsage: usage,
    });

    const result = await provider.transcribe(
      new Uint8Array([1, 2, 3]),
      "audio/webm",
      new AbortController().signal,
    );

    expect(result).toEqual({
      text: "go north",
      language: "en",
      usage: expect.objectContaining({
        provider: "openai",
        capability: "transcription",
        model: "gpt-4o-mini-transcribe",
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        inputAudioBytes: 3,
      }),
    });
    expect(calls[0]?.url).toBe(
      "https://api.openai.com/v1/audio/transcriptions",
    );
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      `Bearer ${testKey}`,
    );
    const body = calls[0]?.init?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("model")).toBe("gpt-4o-mini-transcribe");
    expect(usage).toHaveBeenCalledOnce();
  });

  it("requests one strict guide decision and returns only normalized data", async () => {
    let requestBody: unknown;
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as unknown;
        return jsonResponse({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    kind: "execute",
                    command: "north",
                    intentSummary: "Move north",
                    confidence: 0.97,
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 120, output_tokens: 25, total_tokens: 145 },
        });
      },
    });

    const result = await provider.decideWithUsage(
      guideInput(),
      new AbortController().signal,
    );

    expect(result).toEqual({
      decision: {
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.97,
      },
      usage: expect.objectContaining({
        provider: "openai",
        capability: "guide",
        inputTokens: 120,
        outputTokens: 25,
        totalTokens: 145,
      }),
    });
    expect(requestBody).toMatchObject({
      model: "gpt-4o-mini-2024-07-18",
      store: false,
      max_output_tokens: 300,
      text: {
        format: {
          type: "json_schema",
          name: "initial_guide_decision",
          strict: true,
          schema: { type: "object", anyOf: expect.any(Array) },
        },
      },
    });
    expect(JSON.stringify(requestBody)).not.toContain(testKey);
  });

  it("keeps guide and narrator speech distinct and detached", async () => {
    const bodies: unknown[] = [];
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as unknown);
        return new Response(new Uint8Array([9, 8, 7]), {
          status: 200,
          headers: {
            "content-type": "audio/mpeg",
            "content-length": "3",
          },
        });
      },
    });

    const guide = await provider.synthesize(
      "Which door?",
      "guide",
      new AbortController().signal,
    );
    const narrator = await provider.synthesize(
      "Exact game prose.",
      "narrator",
      new AbortController().signal,
    );

    expect(bodies).toEqual([
      expect.objectContaining({ voice: "nova", input: "Which door?" }),
      expect.objectContaining({ voice: "onyx", input: "Exact game prose." }),
    ]);
    expect([...guide.bytes]).toEqual([9, 8, 7]);
    expect([...narrator.bytes]).toEqual([9, 8, 7]);
    expect(guide.usage).toMatchObject({
      capability: "narration",
      inputCharacters: 11,
    });
  });

  it("fails closed on malformed output and never exposes the key", async () => {
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () => jsonResponse({ output: [] }),
    });

    await expect(
      provider.decide(guideInput(), new AbortController().signal),
    ).rejects.toMatchObject({
      name: "ProviderAdapterError",
      code: "malformed-response",
    });
    await expect(
      new OpenAiChainedProvider({
        apiKey: testKey,
        fetch: async () => jsonResponse({ error: "denied" }, 401),
      }).decide(guideInput(), new AbortController().signal),
    ).rejects.not.toThrow(testKey);
  });

  it("enforces its request budget before making another provider call", async () => {
    const fetchStub = vi.fn<typeof fetch>(async () =>
      jsonResponse({ text: "north" }),
    );
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: fetchStub,
      profile: {
        ...OPENAI_CHAINED_PROFILE_2026_08_18,
        maxRequests: 1,
      },
    });
    await provider.transcribe(
      new Uint8Array([1]),
      "audio/webm",
      new AbortController().signal,
    );

    await expect(
      provider.transcribe(
        new Uint8Array([2]),
        "audio/webm",
        new AbortController().signal,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProviderAdapterError>>({
        code: "budget-exhausted",
      }),
    );
    expect(fetchStub).toHaveBeenCalledOnce();
  });

  it("normalizes cancellation without retrying", async () => {
    const fetchStub = vi.fn<typeof fetch>(async (_input, init) => {
      init?.signal?.throwIfAborted();
      throw new Error("unexpected transport continuation");
    });
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: fetchStub,
    });
    const abort = new AbortController();
    abort.abort(new Error("test cancellation"));

    await expect(
      provider.transcribe(new Uint8Array([1]), "audio/webm", abort.signal),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(fetchStub).toHaveBeenCalledOnce();
  });
});
