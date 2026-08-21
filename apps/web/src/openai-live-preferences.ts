export const OPENAI_TTS_VOICES = Object.freeze([
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
] as const);

export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];

export const MIN_SPEECH_RATE = 0.75;
export const MAX_SPEECH_RATE = 1.25;
export const DEFAULT_OPENAI_LIVE_VOICE_PREFERENCES = Object.freeze({
  schemaVersion: 1 as const,
  guideVoice: "nova" as const,
  narratorVoice: "onyx" as const,
  guideRate: 1,
  narratorRate: 1,
});

export interface OpenAiLiveVoicePreferences {
  readonly schemaVersion: 1;
  readonly guideVoice: OpenAiTtsVoice;
  readonly narratorVoice: OpenAiTtsVoice;
  readonly guideRate: number;
  readonly narratorRate: number;
}

export interface VoicePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Preserved by ADR-0028 so the public-name change does not discard existing
// local developer preferences.
export const OPENAI_LIVE_VOICE_PREFERENCES_KEY =
  "zork-voice.openai-live.voice-preferences.v1";

function isVoice(value: unknown): value is OpenAiTtsVoice {
  return (
    typeof value === "string" &&
    OPENAI_TTS_VOICES.includes(value as OpenAiTtsVoice)
  );
}

function speechRate(value: unknown): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < MIN_SPEECH_RATE ||
    value > MAX_SPEECH_RATE
  ) {
    return undefined;
  }
  return Math.round(value * 100) / 100;
}

export function normalizeOpenAiLiveVoicePreferences(
  value: unknown,
): OpenAiLiveVoicePreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_OPENAI_LIVE_VOICE_PREFERENCES;
  }
  const schemaVersion = Reflect.get(value, "schemaVersion") as unknown;
  const guideVoice = Reflect.get(value, "guideVoice") as unknown;
  const narratorVoice = Reflect.get(value, "narratorVoice") as unknown;
  const guideRate = speechRate(Reflect.get(value, "guideRate"));
  const narratorRate = speechRate(Reflect.get(value, "narratorRate"));
  if (
    schemaVersion !== 1 ||
    !isVoice(guideVoice) ||
    !isVoice(narratorVoice) ||
    guideRate === undefined ||
    narratorRate === undefined
  ) {
    return DEFAULT_OPENAI_LIVE_VOICE_PREFERENCES;
  }
  return Object.freeze({
    schemaVersion: 1,
    guideVoice,
    narratorVoice,
    guideRate,
    narratorRate,
  });
}

export function loadOpenAiLiveVoicePreferences(
  storage: VoicePreferenceStorage,
): OpenAiLiveVoicePreferences {
  try {
    const serialized = storage.getItem(OPENAI_LIVE_VOICE_PREFERENCES_KEY);
    return serialized === null
      ? DEFAULT_OPENAI_LIVE_VOICE_PREFERENCES
      : normalizeOpenAiLiveVoicePreferences(JSON.parse(serialized) as unknown);
  } catch {
    return DEFAULT_OPENAI_LIVE_VOICE_PREFERENCES;
  }
}

export function saveOpenAiLiveVoicePreferences(
  storage: VoicePreferenceStorage,
  value: OpenAiLiveVoicePreferences,
): OpenAiLiveVoicePreferences {
  const normalized = normalizeOpenAiLiveVoicePreferences(value);
  storage.setItem(
    OPENAI_LIVE_VOICE_PREFERENCES_KEY,
    JSON.stringify(normalized),
  );
  return normalized;
}

function sameVoicePreferences(
  left: OpenAiLiveVoicePreferences,
  right: OpenAiLiveVoicePreferences,
): boolean {
  return (
    left.guideVoice === right.guideVoice &&
    left.narratorVoice === right.narratorVoice &&
    left.guideRate === right.guideRate &&
    left.narratorRate === right.narratorRate
  );
}

export class OpenAiLiveVoicePreferenceSession {
  #preferences: OpenAiLiveVoicePreferences;
  #dirty = false;

  public constructor(private readonly storage: VoicePreferenceStorage) {
    this.#preferences = loadOpenAiLiveVoicePreferences(storage);
  }

  public get current(): OpenAiLiveVoicePreferences {
    return this.#preferences;
  }

  public update(
    update: Partial<OpenAiLiveVoicePreferences>,
  ): OpenAiLiveVoicePreferences {
    if (
      (update.schemaVersion !== undefined && update.schemaVersion !== 1) ||
      (update.guideVoice !== undefined && !isVoice(update.guideVoice)) ||
      (update.narratorVoice !== undefined && !isVoice(update.narratorVoice)) ||
      (update.guideRate !== undefined &&
        speechRate(update.guideRate) === undefined) ||
      (update.narratorRate !== undefined &&
        speechRate(update.narratorRate) === undefined)
    ) {
      return this.#preferences;
    }
    const next = normalizeOpenAiLiveVoicePreferences({
      ...this.#preferences,
      ...update,
    });
    if (!sameVoicePreferences(this.#preferences, next)) {
      this.#preferences = next;
      this.#dirty = true;
    }
    return this.#preferences;
  }

  public persist(): boolean {
    if (!this.#dirty) return true;
    try {
      this.#preferences = saveOpenAiLiveVoicePreferences(
        this.storage,
        this.#preferences,
      );
      this.#dirty = false;
      return true;
    } catch {
      // Keep the valid in-session preference and retry at the next boundary.
      return false;
    }
  }
}

export function openAiSpeechPreferenceForRole(
  preferences: OpenAiLiveVoicePreferences,
  role: "guide" | "narrator",
): { readonly voice: OpenAiTtsVoice; readonly speed: number } {
  return role === "guide"
    ? { voice: preferences.guideVoice, speed: preferences.guideRate }
    : { voice: preferences.narratorVoice, speed: preferences.narratorRate };
}
