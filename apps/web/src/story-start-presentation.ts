import type { VoiceAudioState } from "../../../packages/audio/src/index.js";
import type { OpeningNarrationResult } from "../../../packages/session/src/index.js";

export type StoryStartPhase =
  "welcome" | "introducing" | "story-ready" | "starting" | "started";

export interface OpeningPreparationDisposition {
  readonly retryAvailable: boolean;
  readonly failed: boolean;
}

export type OpeningActivationFailureDisposition = "player-cancelled" | "failed";

export function openingActivationFailureDisposition(
  signalAborted: boolean,
  stopRequested: boolean,
): OpeningActivationFailureDisposition {
  return signalAborted && stopRequested ? "player-cancelled" : "failed";
}

export function openingPreparationDisposition(
  outcome: OpeningNarrationResult["outcome"],
): OpeningPreparationDisposition {
  return {
    retryAvailable: outcome !== "ready",
    failed: outcome === "failed",
  };
}

export interface StoryStartPresentationElements {
  readonly shell: { readonly dataset: { storyPhase?: string } };
  readonly primaryButton: {
    textContent: string | null;
    disabled: boolean;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  };
  readonly stopButton: { disabled: boolean };
  readonly pauseButton: { disabled: boolean };
  readonly repeatButton: { disabled: boolean };
  readonly textInput: { disabled: boolean };
  readonly textSubmitButton: { disabled: boolean };
  readonly primaryCue: { textContent: string | null };
}

export function applyStoryStartPresentation(
  phase: StoryStartPhase,
  voiceState: VoiceAudioState,
  voiceAvailable: boolean,
  elements: StoryStartPresentationElements,
): void {
  elements.shell.dataset.storyPhase = phase;
  if (phase !== "started") {
    const introducing = phase === "introducing";
    const storyGate = phase === "story-ready" || phase === "starting";
    elements.primaryButton.textContent = storyGate
      ? "THE STORY BEGINS"
      : introducing
        ? "LISTEN"
        : "ENTER";
    elements.primaryButton.setAttribute(
      "aria-label",
      storyGate ? "Start story" : "Meet your guide and narrator",
    );
    elements.primaryButton.removeAttribute("aria-pressed");
    elements.primaryButton.disabled = introducing || phase === "starting";
    elements.stopButton.disabled = !introducing && phase !== "starting";
    elements.pauseButton.disabled = true;
    elements.repeatButton.disabled = true;
    elements.textInput.disabled = true;
    elements.textSubmitButton.disabled = true;
    elements.primaryCue.textContent =
      phase === "story-ready" ? "Begin the adventure." : "";
    return;
  }

  const listening = voiceState === "listening";
  const captureBusy =
    voiceState === "requesting-microphone" ||
    voiceState === "processing" ||
    voiceState === "guide-speaking" ||
    voiceState === "narrator-speaking" ||
    voiceState === "paused";
  elements.primaryButton.textContent = listening ? "DONE" : "SPEAK";
  elements.primaryButton.setAttribute(
    "aria-label",
    listening ? "Finish speaking" : "Start speaking",
  );
  elements.primaryButton.setAttribute("aria-pressed", String(listening));
  elements.primaryButton.disabled = !voiceAvailable || captureBusy;
  const textReady =
    voiceState === "ready" || voiceState === "recoverable-error";
  const active =
    voiceState === "requesting-microphone" ||
    voiceState === "listening" ||
    voiceState === "processing" ||
    voiceState === "guide-speaking" ||
    voiceState === "narrator-speaking";
  elements.stopButton.disabled = !active;
  elements.pauseButton.disabled = !active && voiceState !== "paused";
  elements.repeatButton.disabled = !textReady;
  elements.textInput.disabled = !textReady;
  elements.textSubmitButton.disabled = !textReady;
  elements.primaryCue.textContent = "or press V";
}
