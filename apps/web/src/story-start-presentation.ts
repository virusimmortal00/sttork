import type { VoiceAudioState } from "../../../packages/audio/src/index.js";
import type { StoryStartPhase } from "../../../packages/experience/src/index.js";
import type { OpeningNarrationResult } from "../../../packages/session/src/index.js";

export type { StoryStartPhase } from "../../../packages/experience/src/index.js";

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
  if (phase !== "started") {
    elements.primaryButton.textContent = "START STORY";
    elements.primaryButton.removeAttribute("aria-pressed");
    elements.primaryButton.disabled = phase === "starting";
    elements.stopButton.disabled = phase !== "starting";
    elements.pauseButton.disabled = true;
    elements.repeatButton.disabled = true;
    elements.textInput.disabled = true;
    elements.textSubmitButton.disabled = true;
    elements.primaryCue.textContent = "Use Start story to hear the opening.";
    return;
  }

  const listening = voiceState === "listening";
  const captureBusy =
    voiceState === "requesting-microphone" ||
    voiceState === "processing" ||
    voiceState === "guide-speaking" ||
    voiceState === "narrator-speaking" ||
    voiceState === "paused";
  elements.primaryButton.textContent = listening
    ? "Finish speaking"
    : "Start speaking";
  elements.primaryButton.setAttribute("aria-pressed", String(listening));
  elements.primaryButton.disabled = !voiceAvailable || captureBusy;
  elements.stopButton.disabled = false;
  elements.pauseButton.disabled = false;
  elements.repeatButton.disabled = false;
  const textReady =
    voiceState === "ready" || voiceState === "recoverable-error";
  elements.textInput.disabled = !textReady;
  elements.textSubmitButton.disabled = !textReady;
  elements.primaryCue.textContent = "Press V or use the speaking control.";
}
