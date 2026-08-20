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
  readonly status: {
    textContent: string | null;
    readonly dataset: { speakerRole?: string };
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  };
  readonly activityIndicator: {
    readonly dataset: { state?: string };
    hidden: boolean | string;
  };
}

export interface CanonicalStatusProjection {
  readonly displayState: ExperienceDisplayState;
  readonly statusText: string;
}

export interface VoiceStatePresentation {
  readonly state: VoiceAudioState | ExperienceDisplayState;
  readonly statusText: string;
}

export function authoritativeVoiceStatePresentation(
  state: VoiceAudioState,
  statusText: string,
  projection: CanonicalStatusProjection,
): VoiceStatePresentation {
  const activeOperation =
    state === "requesting-microphone" ||
    state === "listening" ||
    state === "processing" ||
    state === "guide-speaking" ||
    state === "narrator-speaking";
  return projection.displayState === "blocked" && !activeOperation
    ? { state: "blocked", statusText: projection.statusText }
    : { state, statusText };
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
  const speakerRole =
    state === "guide-speaking"
      ? "Guide"
      : state === "narrator-speaking"
        ? "Narrator"
        : undefined;
  const visibleStatusText = speakerRole === undefined ? statusText : "speaking";
  if (elements.status.textContent !== visibleStatusText) {
    elements.status.textContent = visibleStatusText;
  }
  if (speakerRole === undefined) {
    if (elements.status.dataset.speakerRole !== undefined) {
      delete elements.status.dataset.speakerRole;
      elements.status.removeAttribute("aria-label");
    }
  } else {
    elements.status.dataset.speakerRole = speakerRole;
    elements.status.setAttribute("aria-label", statusText);
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
