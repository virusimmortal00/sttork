import type { VoiceAudioState } from "../../../packages/audio/src/index.js";
import type {
  CommandCueProjection,
  ExperienceDisplayState,
} from "../../../packages/experience/src/index.js";

export type VoiceActivityState =
  | "starting"
  | "idle"
  | "requesting"
  | "listening"
  | "processing"
  | "speaking"
  | "paused"
  | "blocked";

export interface VoiceStatePresentationElements {
  readonly status: { textContent: string | null };
  readonly activityIndicator: {
    readonly dataset: { state?: string };
    hidden: boolean | string;
  };
}

export interface CommandCuePresentationElement {
  textContent: string | null;
}

export function activityStateForVoiceState(
  state: VoiceAudioState | ExperienceDisplayState,
): VoiceActivityState {
  switch (state) {
    case "booting":
      return "starting";
    case "ready":
      return "idle";
    case "requesting-microphone":
      return "requesting";
    case "listening":
      return "listening";
    case "processing":
    case "reconnecting":
      return "processing";
    case "guide-speaking":
    case "narrator-speaking":
      return "speaking";
    case "paused":
      return "paused";
    case "recoverable-error":
    case "blocked":
    case "ended":
      return "blocked";
  }
}

export function statusTextForVoiceAudioState(
  state: VoiceAudioState,
  readyText: string,
): string {
  switch (state) {
    case "ready":
      return readyText;
    case "requesting-microphone":
      return "Requesting microphone";
    case "listening":
      return "Listening";
    case "processing":
      return "Processing";
    case "guide-speaking":
      return "Guide speaking";
    case "narrator-speaking":
      return "Narrator speaking";
    case "paused":
      return "Paused";
    case "recoverable-error":
      return "Try again or use text input";
  }
}

export function activityIndicatorIsVisible(
  state: VoiceAudioState | ExperienceDisplayState,
): boolean {
  switch (activityStateForVoiceState(state)) {
    case "starting":
    case "requesting":
    case "listening":
    case "processing":
    case "speaking":
      return true;
    case "idle":
    case "paused":
    case "blocked":
      return false;
  }
}

export function applyVoiceStatePresentation(
  state: VoiceAudioState | ExperienceDisplayState,
  statusText: string,
  elements: VoiceStatePresentationElements,
): void {
  if (elements.status.textContent !== statusText) {
    elements.status.textContent = statusText;
  }
  const activityState = activityStateForVoiceState(state);
  if (elements.activityIndicator.dataset.state !== activityState) {
    elements.activityIndicator.dataset.state = activityState;
  }
  const hidden = !activityIndicatorIsVisible(state);
  if (elements.activityIndicator.hidden !== hidden) {
    elements.activityIndicator.hidden = hidden;
  }
}

export function commandCueText(
  command: CommandCueProjection | undefined,
): string {
  return command === undefined ? "" : `Command: ${command.command}`;
}

export function applyCommandCuePresentation(
  command: CommandCueProjection | undefined,
  element: CommandCuePresentationElement,
): void {
  const text = commandCueText(command);
  if (element.textContent !== text) element.textContent = text;
}
