import { createOpeningCommandKnowledge } from "@zork-voice/command-knowledge";
import { describe, expect, it, vi } from "vitest";

import type { ProviderAdapterError } from "./contracts.js";
import {
  OPENAI_CHAINED_PROFILE_2026_08_18,
  OPENAI_CHAINED_PROFILE_2026_08_19,
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
    pendingIntent: {
      kind: "read-examine-choice" as const,
      objectValueId: "observed-object:token",
      allowedActions: ["examine", "read"] as const,
    },
    knowledge: createOpeningCommandKnowledge({ observedObjects: ["token"] }),
  };
}

describe("OpenAiChainedProvider", () => {
  it("pins the current live developer smoke models and request ceiling", () => {
    expect(OPENAI_CHAINED_PROFILE_2026_08_19.maxRequests).toBe(30);
    expect(OPENAI_CHAINED_PROFILE_2026_08_19.transcriptionModel).toBe(
      "gpt-transcribe",
    );
    expect(OPENAI_CHAINED_PROFILE_2026_08_19.narrationModel).toBe(
      "gpt-4o-mini-tts",
    );
    expect(OPENAI_CHAINED_PROFILE_2026_08_18.transcriptionModel).toBe(
      "gpt-4o-mini-transcribe",
    );
    expect(OPENAI_CHAINED_PROFILE_2026_08_18.narrationModel).toBe("tts-1");
  });

  it("normalizes transcription and reports bounded usage", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchStub: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse({
        text: "go north",
        languages: [{ code: "en" }],
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
      languages: ["en"],
      usage: expect.objectContaining({
        provider: "openai",
        capability: "transcription",
        model: "gpt-transcribe",
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
    expect((body as FormData).get("model")).toBe("gpt-transcribe");
    expect(usage).toHaveBeenCalledOnce();
  });

  it("preserves multiple detected languages without collapsing them", async () => {
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () =>
        jsonResponse({
          text: "go north, puis regarde",
          languages: [{ code: "en" }, { code: "fr" }],
        }),
    });

    const result = await provider.transcribe(
      new Uint8Array([1]),
      "audio/webm",
      new AbortController().signal,
    );

    expect(result.languages).toEqual(["en", "fr"]);
  });

  it("normalizes an unavailable detected language to an empty list", async () => {
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () => jsonResponse({ text: "go north", languages: [] }),
    });

    const result = await provider.transcribe(
      new Uint8Array([1]),
      "audio/webm",
      new AbortController().signal,
    );

    expect(result.languages).toEqual([]);
  });

  it("normalizes duration-billed transcription usage", async () => {
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () =>
        jsonResponse({
          text: "go north",
          languages: [{ code: "en" }],
          usage: { type: "duration", seconds: 1.25 },
        }),
    });

    const result = await provider.transcribe(
      new Uint8Array([1]),
      "audio/webm",
      new AbortController().signal,
    );

    expect(result.usage).toMatchObject({
      model: "gpt-transcribe",
      inputAudioBytes: 1,
      inputAudioSeconds: 1.25,
    });
  });

  it.each([
    { type: "duration", seconds: -1 },
    { type: "duration", seconds: "1.25" },
    { type: "tokens", seconds: 1.25 },
  ])("ignores malformed or non-duration audio usage", async (usage) => {
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () =>
        jsonResponse({ text: "go north", languages: [], usage }),
    });

    const result = await provider.transcribe(
      new Uint8Array([1]),
      "audio/webm",
      new AbortController().signal,
    );

    expect(result.usage).not.toHaveProperty("inputAudioSeconds");
  });

  it.each([
    { text: "go north", languages: "en" },
    { text: "go north", languages: [{ code: "en\nunsafe" }] },
    { text: "go north", languages: [{ name: "English" }] },
  ])("rejects malformed detected languages", async (response) => {
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () => jsonResponse(response),
    });

    await expect(
      provider.transcribe(
        new Uint8Array([1]),
        "audio/webm",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "malformed-response" });
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
                    decision: {
                      kind: "execute",
                      affordanceId: "grammar.direction.north",
                      slots: [],
                      intentSummary: "Move north",
                      confidence: 0.97,
                    },
                  }),
                },
              ],
            },
          ],
          usage: {
            input_tokens: 120,
            input_tokens_details: {
              cached_tokens: 80,
              cache_write_tokens: 0,
            },
            output_tokens: 25,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 145,
          },
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
        affordanceId: "grammar.direction.north",
        slots: [],
        intentSummary: "Move north",
        confidence: 0.97,
      },
      usage: expect.objectContaining({
        provider: "openai",
        capability: "guide",
        inputTokens: 120,
        cachedInputTokens: 80,
        cacheWriteInputTokens: 0,
        outputTokens: 25,
        reasoningTokens: 0,
        totalTokens: 145,
      }),
    });
    expect(requestBody).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      max_output_tokens: 300,
      reasoning: { effort: "none", context: "current_turn" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "initial_guide_decision",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["decision"],
            properties: {
              decision: {
                anyOf: expect.arrayContaining([
                  expect.objectContaining({
                    required: [
                      "kind",
                      "affordanceId",
                      "slots",
                      "intentSummary",
                      "confidence",
                    ],
                    properties: expect.objectContaining({
                      kind: { type: "string", enum: ["execute"] },
                      affordanceId: {
                        type: "string",
                        minLength: 1,
                        maxLength: 160,
                      },
                      slots: {
                        type: "array",
                        minItems: 0,
                        maxItems: 1,
                        items: {
                          type: "object",
                          additionalProperties: false,
                          required: ["slotId", "valueId"],
                          properties: {
                            slotId: {
                              type: "string",
                              enum: ["object"],
                            },
                            valueId: {
                              type: "string",
                              minLength: 1,
                              maxLength: 160,
                            },
                          },
                        },
                      },
                    }),
                  }),
                  expect.objectContaining({
                    required: ["kind", "question", "ambiguity", "choices"],
                    properties: expect.objectContaining({
                      kind: { type: "string", enum: ["clarify"] },
                      choices: {
                        type: "array",
                        minItems: 2,
                        maxItems: 3,
                        items: {
                          type: "string",
                          minLength: 1,
                          maxLength: 160,
                        },
                      },
                    }),
                  }),
                  expect.objectContaining({
                    required: ["kind", "response", "basis", "sourceIds"],
                    properties: expect.objectContaining({
                      kind: { type: "string", enum: ["explain"] },
                      basis: { type: "string", enum: ["command-help"] },
                    }),
                  }),
                ]),
              },
            },
          },
        },
      },
    });
    expect(
      JSON.parse((requestBody as { input: string }).input) as unknown,
    ).toMatchObject({
      pendingIntent: {
        kind: "read-examine-choice",
        objectValueId: "observed-object:token",
        allowedActions: ["examine", "read"],
      },
    });
    expect(JSON.stringify(requestBody)).not.toContain('"const"');
    const schema = (
      requestBody as {
        text: {
          format: {
            schema: {
              properties: {
                decision: {
                  anyOf: Array<{
                    additionalProperties: boolean;
                    required: string[];
                    properties: Record<
                      string,
                      { enum?: string[]; type: string }
                    >;
                  }>;
                };
              };
            };
          };
        };
      }
    ).text.format.schema;
    const branches = schema.properties.decision.anyOf;
    expect(branches.map((branch) => branch.properties.kind?.enum?.[0])).toEqual(
      ["execute", "clarify", "explain", "cannot_comply"],
    );
    expect(
      branches.every(
        (branch) =>
          branch.additionalProperties === false &&
          branch.required.length === Object.keys(branch.properties).length,
      ),
    ).toBe(true);
    expect(JSON.stringify(schema)).not.toContain('"type":"null"');
    expect(branches[0]?.properties).not.toHaveProperty("command");
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "select affordanceId as the exact ID of one current commandKnowledge rule",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "Questions about parser vocabulary, syntax, behavior, or differences between available commands are command help, not game actions",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "return explain with basis command-help and exactly the relevant current commandKnowledge rule IDs as sourceIds",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "optional pendingIntent is bounded current dialogue focus",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "return explain with exactly grammar.examine and grammar.read as sourceIds",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "never execute a command merely because the question names it",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "riskTier and semanticFallbackAllowed as selection policy",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "semanticFallbackAllowed is true, classify natural paraphrases semantically",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "when it is false, select that rule only when the player explicitly uses one of its aliases",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "For an unambiguous request, prefer the lowest-risk rule that fully satisfies",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "content wording could reasonably mean either lower-risk grammar.examine or higher-risk grammar.read",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "return clarify instead of execute",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "For every clarification, supply two or three concise, explicit player-selectable choices",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "For an ambiguous EXAMINE/READ clarification, choices must offer both EXAMINE and READ",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "Never silently choose the higher-risk grammar.read action",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "aliases and grammar examples as non-exhaustive examples for rules that allow semantic fallback",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "select only slot value IDs currently allowed by commandKnowledge",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "Return slots: [] for a zero-slot rule",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "check out one observed object selects grammar.examine",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining("Never write parser command text"),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining("Return one action only"),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "direct player question asking to observe or describe",
      ),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining(
        "Do not execute an action merely quoted",
      ),
    });
    expect(JSON.stringify(requestBody)).not.toContain(testKey);
  });

  it.each([
    {
      name: "bounded clarification choices",
      decision: {
        kind: "clarify",
        question: "Would you like to EXAMINE the leaflet or READ its contents?",
        ambiguity: "The request could mean either inspection or reading.",
        choices: ["EXAMINE the leaflet", "READ the leaflet"],
      },
    },
    {
      name: "grounded explanation",
      decision: {
        kind: "explain",
        response: "You can ask to move in a direction.",
        basis: "command-help",
        sourceIds: ["opening:movement"],
      },
    },
    {
      name: "unsupported request",
      decision: {
        kind: "cannot_comply",
        response: "I can help with game commands.",
        reason: "unsupported",
      },
    },
  ])("normalizes the $name decision branch", async ({ decision }) => {
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () =>
        jsonResponse({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ decision }),
                },
              ],
            },
          ],
        }),
    });

    await expect(
      provider.decide(guideInput(), new AbortController().signal),
    ).resolves.toEqual(decision);
  });

  it("rejects stale pending focus before spending a guide request", async () => {
    const fetchMock = vi.fn();
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: fetchMock,
    });

    await expect(
      provider.decide(
        {
          ...guideInput(),
          pendingIntent: {
            kind: "read-examine-choice",
            objectValueId: "observed-object:hidden object",
            allowedActions: ["examine", "read"],
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "missing choices",
      decision: {
        kind: "clarify",
        question: "Which action do you mean?",
        ambiguity: "The requested action is ambiguous.",
      },
    },
    {
      name: "non-array choices",
      decision: {
        kind: "clarify",
        question: "Which action do you mean?",
        ambiguity: "The requested action is ambiguous.",
        choices: "EXAMINE or READ",
      },
    },
    {
      name: "too few choices",
      decision: {
        kind: "clarify",
        question: "Which action do you mean?",
        ambiguity: "The requested action is ambiguous.",
        choices: ["EXAMINE the leaflet"],
      },
    },
    {
      name: "too many choices",
      decision: {
        kind: "clarify",
        question: "Which action do you mean?",
        ambiguity: "The requested action is ambiguous.",
        choices: ["EXAMINE", "READ", "OPEN", "TAKE"],
      },
    },
    {
      name: "non-string choice",
      decision: {
        kind: "clarify",
        question: "Which action do you mean?",
        ambiguity: "The requested action is ambiguous.",
        choices: ["EXAMINE the leaflet", 7],
      },
    },
    {
      name: "empty choice",
      decision: {
        kind: "clarify",
        question: "Which action do you mean?",
        ambiguity: "The requested action is ambiguous.",
        choices: ["EXAMINE the leaflet", ""],
      },
    },
    {
      name: "oversized choice",
      decision: {
        kind: "clarify",
        question: "Which action do you mean?",
        ambiguity: "The requested action is ambiguous.",
        choices: ["EXAMINE the leaflet", "r".repeat(161)],
      },
    },
    {
      name: "extra clarification field",
      decision: {
        kind: "clarify",
        question: "Which action do you mean?",
        ambiguity: "The requested action is ambiguous.",
        choices: ["EXAMINE the leaflet", "READ the leaflet"],
        defaultChoice: "EXAMINE the leaflet",
      },
    },
  ])("rejects a clarification with $name", async ({ decision }) => {
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () =>
        jsonResponse({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ decision }),
                },
              ],
            },
          ],
        }),
    });

    await expect(
      provider.decide(guideInput(), new AbortController().signal),
    ).rejects.toMatchObject({
      name: "ProviderAdapterError",
      code: "malformed-response",
    });
  });

  it("normalizes one observed-object slot without parser command text", async () => {
    const decision = {
      kind: "execute",
      affordanceId: "grammar.examine",
      slots: [{ slotId: "object", valueId: "observed-object:mailbox" }],
      intentSummary: "Observe the mailbox more closely",
      confidence: 0.98,
    } as const;
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () =>
        jsonResponse({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ decision }),
                },
              ],
            },
          ],
        }),
    });

    await expect(
      provider.decide(guideInput(), new AbortController().signal),
    ).resolves.toEqual(decision);
  });

  it("adds only a caller-supplied privacy-preserving safety identifier", async () => {
    let requestBody: unknown;
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      safetyIdentifier: "sha256-user-7c4f4a6b",
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
                    decision: {
                      kind: "clarify",
                      question: "Which direction?",
                      ambiguity: "No direction was supplied.",
                      choices: ["NORTH", "SOUTH"],
                    },
                  }),
                },
              ],
            },
          ],
        });
      },
    });

    await provider.decideWithUsage(
      { ...guideInput(), playerUtterance: "go" },
      new AbortController().signal,
    );

    expect(requestBody).toMatchObject({
      safety_identifier: "sha256-user-7c4f4a6b",
    });
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
      "Exact game prose.\n\n> ",
      "narrator",
      new AbortController().signal,
    );

    expect(bodies).toEqual([
      {
        model: "gpt-4o-mini-tts",
        voice: "nova",
        input: "Which door?",
        response_format: "mp3",
        speed: 1,
      },
      {
        model: "gpt-4o-mini-tts",
        voice: "onyx",
        input: "Exact game prose.\n\n> ",
        response_format: "mp3",
        speed: 1,
      },
    ]);
    expect([...guide.bytes]).toEqual([9, 8, 7]);
    expect([...narrator.bytes]).toEqual([9, 8, 7]);
    expect(guide.usage).toMatchObject({
      capability: "narration",
      model: "gpt-4o-mini-tts",
      inputCharacters: 11,
    });
  });

  it("takes role voice IDs from the provider profile", async () => {
    const bodies: unknown[] = [];
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      profile: {
        ...OPENAI_CHAINED_PROFILE_2026_08_18,
        guideVoice: "guide-test-voice",
        narratorVoice: "narrator-test-voice",
      },
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as unknown);
        return new Response(new Uint8Array([1]), {
          headers: { "content-type": "audio/mpeg" },
        });
      },
    });

    await provider.synthesize(
      "Guide response.",
      "guide",
      new AbortController().signal,
    );
    await provider.synthesize(
      "Exact game prose.",
      "narrator",
      new AbortController().signal,
    );

    expect(bodies).toEqual([
      expect.objectContaining({ voice: "guide-test-voice" }),
      expect.objectContaining({ voice: "narrator-test-voice" }),
    ]);
  });

  it("rejects an unsafe configured voice before a provider request", async () => {
    const fetchStub = vi.fn<typeof fetch>();
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      profile: {
        ...OPENAI_CHAINED_PROFILE_2026_08_18,
        guideVoice: "unsafe\nvoice",
      },
      fetch: fetchStub,
    });

    await expect(
      provider.synthesize(
        "Guide response.",
        "guide",
        new AbortController().signal,
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "invalid-input" }));
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("rejects C1 controls while preserving narration whitespace", async () => {
    const fetchStub = vi.fn<typeof fetch>();
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: fetchStub,
    });

    await expect(
      provider.synthesize(
        "unsafe\u0085prose",
        "narrator",
        new AbortController().signal,
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "invalid-input" }));
    expect(fetchStub).not.toHaveBeenCalled();
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

  it("rejects the former flat nullable shape before domain validation", async () => {
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () =>
        jsonResponse({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    kind: "explain",
                    command: null,
                    intentSummary: null,
                    confidence: null,
                    question: null,
                    ambiguity: null,
                    response: "I can help with commands.",
                    basis: null,
                    sourceIds: null,
                    reason: null,
                  }),
                },
              ],
            },
          ],
        }),
    });

    await expect(
      provider.decide(guideInput(), new AbortController().signal),
    ).rejects.toMatchObject({
      name: "ProviderAdapterError",
      code: "malformed-response",
      message: "Guide output was not a decision envelope.",
    });
  });

  it("rejects fields outside the selected decision branch", async () => {
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () =>
        jsonResponse({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    decision: {
                      kind: "execute",
                      affordanceId: "grammar.direction.north",
                      slots: [],
                      intentSummary: "Move north",
                      confidence: 0.97,
                      command: "north",
                    },
                  }),
                },
              ],
            },
          ],
        }),
    });

    await expect(
      provider.decide(guideInput(), new AbortController().signal),
    ).rejects.toMatchObject({
      name: "ProviderAdapterError",
      code: "malformed-response",
      message: "Guide output fields did not match its decision kind.",
    });
  });

  it.each([
    {
      name: "missing affordance ID",
      decision: {
        kind: "execute",
        slots: [],
        intentSummary: "Move north",
        confidence: 0.97,
      },
    },
    {
      name: "empty affordance ID",
      decision: {
        kind: "execute",
        affordanceId: "",
        slots: [],
        intentSummary: "Move north",
        confidence: 0.97,
      },
    },
    {
      name: "oversized affordance ID",
      decision: {
        kind: "execute",
        affordanceId: "a".repeat(161),
        slots: [],
        intentSummary: "Move north",
        confidence: 0.97,
      },
    },
  ])("rejects an execute decision with a $name", async ({ decision }) => {
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () =>
        jsonResponse({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ decision }),
                },
              ],
            },
          ],
        }),
    });

    await expect(
      provider.decide(guideInput(), new AbortController().signal),
    ).rejects.toMatchObject({
      name: "ProviderAdapterError",
      code: "malformed-response",
    });
  });

  it.each([
    { name: "missing slots", slots: undefined },
    {
      name: "more than one slot",
      slots: [
        { slotId: "object", valueId: "observed-object:mailbox" },
        { slotId: "object", valueId: "observed-object:leaflet" },
      ],
    },
    { name: "non-object slot", slots: ["observed-object:mailbox"] },
    {
      name: "extra slot field",
      slots: [
        {
          slotId: "object",
          valueId: "observed-object:mailbox",
          label: "mailbox",
        },
      ],
    },
    {
      name: "unknown slot identifier",
      slots: [{ slotId: "destination", valueId: "observed-object:mailbox" }],
    },
    { name: "missing value identifier", slots: [{ slotId: "object" }] },
    {
      name: "empty value identifier",
      slots: [{ slotId: "object", valueId: "" }],
    },
    {
      name: "blank value identifier",
      slots: [{ slotId: "object", valueId: "   " }],
    },
    {
      name: "controlled value identifier",
      slots: [{ slotId: "object", valueId: "observed-object:mailbox\nopen" }],
    },
    {
      name: "oversized value identifier",
      slots: [{ slotId: "object", valueId: "a".repeat(161) }],
    },
  ])("rejects an execute decision with $name", async ({ slots }) => {
    const decision = {
      kind: "execute",
      affordanceId: "grammar.examine",
      ...(slots === undefined ? {} : { slots }),
      intentSummary: "Observe one object",
      confidence: 0.97,
    };
    const provider = new OpenAiChainedProvider({
      apiKey: testKey,
      fetch: async () =>
        jsonResponse({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ decision }),
                },
              ],
            },
          ],
        }),
    });

    await expect(
      provider.decide(guideInput(), new AbortController().signal),
    ).rejects.toMatchObject({
      name: "ProviderAdapterError",
      code: "malformed-response",
    });
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
