import { describe, expect, it } from "vitest";

import {
  activityStateForVoiceState,
  applyCommandCuePresentation,
  applyVoiceStatePresentation,
  commandCueText,
  statusTextForVoiceAudioState,
} from "../apps/web/src/voice-state-presentation.js";

describe("voice state presentation", () => {
  it("maps active controller states to stable visual activity states", () => {
    expect(activityStateForVoiceState("requesting-microphone")).toBe(
      "requesting",
    );
    expect(activityStateForVoiceState("listening")).toBe("listening");
    expect(activityStateForVoiceState("processing")).toBe("processing");
    expect(activityStateForVoiceState("guide-speaking")).toBe("speaking");
    expect(activityStateForVoiceState("narrator-speaking")).toBe("speaking");
    expect(activityStateForVoiceState("paused")).toBe("paused");
    expect(activityStateForVoiceState("recoverable-error")).toBe("blocked");
  });

  it("keeps accessible status text stable and respects degraded ready text", () => {
    expect(
      statusTextForVoiceAudioState(
        "ready",
        "Microphone unavailable. Use accessible text input.",
      ),
    ).toBe("Microphone unavailable. Use accessible text input.");
    expect(statusTextForVoiceAudioState("processing", "Ready")).toBe(
      "Processing",
    );
    expect(statusTextForVoiceAudioState("narrator-speaking", "Ready")).toBe(
      "Narrator speaking",
    );

    let textWrites = 0;
    let currentText: string | null = "Processing";
    const status = {
      get textContent(): string | null {
        return currentText;
      },
      set textContent(value: string | null) {
        textWrites += 1;
        currentText = value;
      },
    };
    const activityIndicator = { dataset: { state: "processing" } };

    applyVoiceStatePresentation("processing", "Processing", {
      status,
      activityIndicator,
    });

    expect(textWrites).toBe(0);
    expect(activityIndicator.dataset.state).toBe("processing");
  });

  it("shows only the canonical command and avoids duplicate live-region writes", () => {
    const activeCommand = {
      requestId: "request-1",
      correlationId: "interaction-1",
      command: "examine leaflet",
      phase: "committed" as const,
      sourceEventIds: ["event-1", "event-2"],
      throughSequence: 2,
    };
    expect(commandCueText(activeCommand)).toBe("Command: examine leaflet");

    let writes = 0;
    let currentText: string | null = "Command: examine leaflet";
    const element = {
      get textContent(): string | null {
        return currentText;
      },
      set textContent(value: string | null) {
        writes += 1;
        currentText = value;
      },
    };

    applyCommandCuePresentation(activeCommand, element);
    expect(writes).toBe(0);
    applyCommandCuePresentation(undefined, element);
    expect(writes).toBe(1);
    expect(currentText).toBe("");
  });
});
