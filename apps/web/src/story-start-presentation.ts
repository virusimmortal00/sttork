import type { VoiceAudioState } from "../../../packages/audio/src/index.js";
import type { OpeningNarrationResult } from "../../../packages/session/src/index.js";

export type StoryStartPhase =
  "welcome" | "introducing" | "story-ready" | "starting" | "started";

export type PlayerInputMode = "voice" | "text";

export interface TextComposerKey {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}

export function textComposerShouldSubmit(event: TextComposerKey): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

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
  readonly shell: {
    readonly dataset: { storyPhase?: string; inputMode?: string };
  };
  readonly primaryButton: {
    textContent: string | null;
    hidden: boolean | string;
    disabled: boolean;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  };
  readonly storyGateButton: {
    hidden: boolean | string;
    disabled: boolean;
  };
  readonly idlePrompt: { hidden: boolean | string };
  readonly stopButton: {
    disabled: boolean;
    textContent: string | null;
    setAttribute(name: string, value: string): void;
  };
  readonly repeatButton: { disabled: boolean };
  readonly inputModeSwitch: { hidden: boolean | string };
  readonly voiceModeButton: {
    disabled: boolean;
    setAttribute(name: string, value: string): void;
  };
  readonly textModeButton: {
    disabled: boolean;
    setAttribute(name: string, value: string): void;
  };
  readonly voiceWaveform: { hidden: boolean | string };
  readonly textForm: { hidden: boolean | string };
  readonly textInput: { disabled: boolean };
  readonly textSubmitButton: { disabled: boolean };
  readonly primaryCue: { textContent: string | null };
}

export function applyStoryStartPresentation(
  phase: StoryStartPhase,
  voiceState: VoiceAudioState,
  voiceAvailable: boolean,
  inputMode: PlayerInputMode,
  elements: StoryStartPresentationElements,
): void {
  const playbackPaused = voiceState === "paused";
  elements.stopButton.textContent = playbackPaused ? "▶" : "■";
  elements.stopButton.setAttribute(
    "aria-label",
    playbackPaused ? "Resume playback" : "Stop playback",
  );
  elements.stopButton.setAttribute("title", playbackPaused ? "Resume" : "Stop");
  elements.shell.dataset.storyPhase = phase;
  elements.shell.dataset.inputMode = inputMode;
  if (phase !== "started") {
    const introducing = phase === "introducing";
    const storyGate = phase === "story-ready" || phase === "starting";
    elements.primaryButton.hidden = introducing || storyGate;
    elements.primaryButton.textContent = "ENTER";
    elements.primaryButton.setAttribute(
      "aria-label",
      "Meet your guide and narrator",
    );
    elements.primaryButton.removeAttribute("aria-pressed");
    elements.primaryButton.disabled = introducing || phase === "starting";
    elements.storyGateButton.hidden = !storyGate;
    elements.storyGateButton.disabled = phase === "starting";
    elements.idlePrompt.hidden = true;
    elements.stopButton.disabled =
      !playbackPaused && !introducing && phase !== "starting";
    elements.repeatButton.disabled = true;
    elements.inputModeSwitch.hidden = true;
    elements.voiceWaveform.hidden = true;
    elements.textForm.hidden = true;
    elements.textInput.disabled = true;
    elements.textSubmitButton.disabled = true;
    elements.primaryCue.textContent = "";
    return;
  }

  const effectiveInputMode = voiceAvailable ? inputMode : "text";
  elements.shell.dataset.inputMode = effectiveInputMode;
  elements.inputModeSwitch.hidden = false;
  elements.storyGateButton.hidden = true;
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
  elements.idlePrompt.hidden = !textReady;
  elements.primaryButton.hidden = effectiveInputMode === "text";
  elements.textForm.hidden = effectiveInputMode === "voice";
  elements.voiceWaveform.hidden = effectiveInputMode !== "voice" || !listening;
  elements.voiceModeButton.disabled = !voiceAvailable || !textReady;
  elements.textModeButton.disabled = !textReady;
  elements.voiceModeButton.setAttribute(
    "aria-pressed",
    String(effectiveInputMode === "voice"),
  );
  elements.textModeButton.setAttribute(
    "aria-pressed",
    String(effectiveInputMode === "text"),
  );
  const active =
    voiceState === "requesting-microphone" ||
    voiceState === "listening" ||
    voiceState === "processing" ||
    voiceState === "guide-speaking" ||
    voiceState === "narrator-speaking";
  elements.stopButton.disabled = !active && !playbackPaused;
  elements.repeatButton.disabled = !textReady;
  elements.textInput.disabled = !textReady || effectiveInputMode !== "text";
  elements.textSubmitButton.disabled =
    !textReady || effectiveInputMode !== "text";
  elements.primaryCue.textContent =
    effectiveInputMode === "voice" ? "or press V" : "Enter to send";
}
