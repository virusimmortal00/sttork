import {
  DEFAULT_OPENAI_LIVE_VOICE_PREFERENCES,
  loadOpenAiLiveVoicePreferences,
  normalizeOpenAiLiveVoicePreferences,
  OpenAiLiveVoicePreferenceSession,
  OPENAI_LIVE_VOICE_PREFERENCES_KEY,
  OPENAI_TTS_VOICES,
  openAiSpeechPreferenceForRole,
  saveOpenAiLiveVoicePreferences,
  type VoicePreferenceStorage,
} from "./openai-live-preferences.js";
import { describe, expect, it } from "vitest";

class MemoryStorage implements VoicePreferenceStorage {
  readonly values = new Map<string, string>();
  writes = 0;

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.writes += 1;
    this.values.set(key, value);
  }
}

describe("OpenAI live voice preferences", () => {
  it("publishes the complete reviewed built-in voice catalog", () => {
    expect(OPENAI_TTS_VOICES).toEqual([
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "fable",
      "nova",
      "onyx",
      "sage",
      "shimmer",
      "verse",
      "marin",
      "cedar",
    ]);
  });

  it("round-trips distinct role preferences through bounded local storage", () => {
    const storage = new MemoryStorage();
    const saved = saveOpenAiLiveVoicePreferences(storage, {
      schemaVersion: 1,
      guideVoice: "sage",
      narratorVoice: "cedar",
      guideRate: 1.1,
      narratorRate: 0.85,
    });

    expect(loadOpenAiLiveVoicePreferences(storage)).toEqual(saved);
    expect(storage.values.has(OPENAI_LIVE_VOICE_PREFERENCES_KEY)).toBe(true);
    expect(openAiSpeechPreferenceForRole(saved, "guide")).toEqual({
      voice: "sage",
      speed: 1.1,
    });
    expect(openAiSpeechPreferenceForRole(saved, "narrator")).toEqual({
      voice: "cedar",
      speed: 0.85,
    });
  });

  it.each([
    null,
    { schemaVersion: 2 },
    {
      schemaVersion: 1,
      guideVoice: "unknown",
      narratorVoice: "onyx",
      guideRate: 1,
      narratorRate: 1,
    },
    {
      schemaVersion: 1,
      guideVoice: "nova",
      narratorVoice: "onyx",
      guideRate: 4,
      narratorRate: 1,
    },
  ])("fails closed to defaults for invalid persisted value %#", (value) => {
    expect(normalizeOpenAiLiveVoicePreferences(value)).toBe(
      DEFAULT_OPENAI_LIVE_VOICE_PREFERENCES,
    );
  });

  it("recovers from malformed JSON and unavailable storage", () => {
    const malformed = new MemoryStorage();
    malformed.values.set(OPENAI_LIVE_VOICE_PREFERENCES_KEY, "{");
    expect(loadOpenAiLiveVoicePreferences(malformed)).toBe(
      DEFAULT_OPENAI_LIVE_VOICE_PREFERENCES,
    );
    expect(
      loadOpenAiLiveVoicePreferences({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => undefined,
      }),
    ).toBe(DEFAULT_OPENAI_LIVE_VOICE_PREFERENCES);
  });

  it("keeps a continuous rate adjustment in session and persists once", () => {
    const storage = new MemoryStorage();
    const session = new OpenAiLiveVoicePreferenceSession(storage);

    for (const guideRate of [0.8, 0.9, 1, 1.1, 1.2]) {
      session.update({ guideRate });
      expect(session.current.guideRate).toBe(guideRate);
      expect(openAiSpeechPreferenceForRole(session.current, "guide")).toEqual({
        voice: "nova",
        speed: guideRate,
      });
    }

    expect(storage.writes).toBe(0);
    expect(session.current.narratorRate).toBe(1);
    expect(session.persist()).toBe(true);
    expect(storage.writes).toBe(1);
    expect(
      new OpenAiLiveVoicePreferenceSession(storage).current.guideRate,
    ).toBe(1.2);
    expect(session.persist()).toBe(true);
    expect(storage.writes).toBe(1);
  });

  it("retains valid session state when persistence fails", () => {
    let writes = 0;
    const session = new OpenAiLiveVoicePreferenceSession({
      getItem: () => null,
      setItem: () => {
        writes += 1;
        throw new Error("quota exceeded");
      },
    });

    session.update({ narratorRate: 0.85 });

    expect(session.persist()).toBe(false);
    expect(session.current.narratorRate).toBe(0.85);
    expect(writes).toBe(1);
    expect(session.persist()).toBe(false);
    expect(writes).toBe(2);
  });

  it("ignores an invalid adjustment without replacing valid session state", () => {
    const storage = new MemoryStorage();
    const session = new OpenAiLiveVoicePreferenceSession(storage);
    session.update({ narratorVoice: "cedar", narratorRate: 0.85 });

    session.update({ narratorRate: Number.NaN });

    expect(session.current.narratorVoice).toBe("cedar");
    expect(session.current.narratorRate).toBe(0.85);
    expect(storage.writes).toBe(0);
  });
});
