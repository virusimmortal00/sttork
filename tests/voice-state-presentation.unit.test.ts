import { describe, expect, it, vi } from "vitest";

import {
  activityIndicatorIsVisible,
  activityStateForVoiceState,
  applyCommandCuePresentation,
  applyVoiceStatePresentation,
  authoritativeVoiceStatePresentation,
  commandCueText,
  statusTextForVoiceAudioState,
} from "../apps/web/src/voice-state-presentation.js";

describe("voice state presentation", () => {
  it("keeps a canonical blocked projection authoritative over generic controller recovery text", () => {
    expect(
      authoritativeVoiceStatePresentation(
        "recoverable-error",
        "Try again or use text input",
        { displayState: "blocked", statusText: "Action needed" },
      ),
    ).toEqual({ state: "blocked", statusText: "Action needed" });
    expect(
      authoritativeVoiceStatePresentation("ready", "Ready", {
        displayState: "ready",
        statusText: "Ready",
      }),
    ).toEqual({ state: "ready", statusText: "Ready" });
  });

  it.each([
    ["requesting-microphone" as const, "Requesting microphone"],
    ["listening" as const, "Listening"],
    ["processing" as const, "Processing"],
    ["guide-speaking" as const, "Guide speaking"],
    ["narrator-speaking" as const, "Narrator speaking"],
  ])(
    "lets active controller state %s override a stale blocked projection",
    (state, statusText) => {
      expect(
        authoritativeVoiceStatePresentation(state, statusText, {
          displayState: "blocked",
          statusText: "Action needed",
        }),
      ).toEqual({ state, statusText });
    },
  );

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

  it("shows decorative activity only while work is happening", () => {
    expect(activityIndicatorIsVisible("booting")).toBe(true);
    expect(activityIndicatorIsVisible("requesting-microphone")).toBe(true);
    expect(activityIndicatorIsVisible("listening")).toBe(true);
    expect(activityIndicatorIsVisible("processing")).toBe(true);
    expect(activityIndicatorIsVisible("reconnecting")).toBe(true);
    expect(activityIndicatorIsVisible("guide-speaking")).toBe(true);
    expect(activityIndicatorIsVisible("narrator-speaking")).toBe(true);

    expect(activityIndicatorIsVisible("ready")).toBe(false);
    expect(activityIndicatorIsVisible("paused")).toBe(false);
    expect(activityIndicatorIsVisible("recoverable-error")).toBe(false);
    expect(activityIndicatorIsVisible("blocked")).toBe(false);
    expect(activityIndicatorIsVisible("ended")).toBe(false);
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
      dataset: {} as { speakerRole?: string },
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      get textContent(): string | null {
        return currentText;
      },
      set textContent(value: string | null) {
        textWrites += 1;
        currentText = value;
      },
    };
    let hiddenWrites = 0;
    let currentHidden = false;
    const activityIndicator = {
      dataset: { state: "processing" },
      get hidden(): boolean {
        return currentHidden;
      },
      set hidden(value: boolean) {
        hiddenWrites += 1;
        currentHidden = value;
      },
    };

    applyVoiceStatePresentation("processing", "Processing", {
      status,
      activityIndicator,
    });

    expect(textWrites).toBe(0);
    expect(hiddenWrites).toBe(0);
    expect(activityIndicator.dataset.state).toBe("processing");

    applyVoiceStatePresentation("ready", "Ready", {
      status,
      activityIndicator,
    });
    expect(currentText).toBe("Ready");
    expect(textWrites).toBe(1);
    expect(activityIndicator.dataset.state).toBe("idle");
    expect(currentHidden).toBe(true);
    expect(hiddenWrites).toBe(1);

    applyVoiceStatePresentation("ready", "Ready", {
      status,
      activityIndicator,
    });
    expect(textWrites).toBe(1);
    expect(hiddenWrites).toBe(1);

    applyVoiceStatePresentation("processing", "Processing", {
      status,
      activityIndicator,
    });
    expect(currentText).toBe("Processing");
    expect(textWrites).toBe(2);
    expect(activityIndicator.dataset.state).toBe("processing");
    expect(currentHidden).toBe(false);
    expect(hiddenWrites).toBe(2);
  });

  it("renders speaking states as a compact role plus verb with a complete accessible label", () => {
    const status = {
      textContent: "Processing" as string | null,
      dataset: {} as { speakerRole?: string },
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const activityIndicator = {
      dataset: {} as { state?: string },
      hidden: true,
    };

    applyVoiceStatePresentation("narrator-speaking", "Narrator speaking", {
      status,
      activityIndicator,
    });
    expect(status.textContent).toBe("speaking");
    expect(status.dataset.speakerRole).toBe("Narrator");
    expect(status.setAttribute).toHaveBeenCalledWith(
      "aria-label",
      "Narrator speaking",
    );

    applyVoiceStatePresentation("guide-speaking", "Guide speaking", {
      status,
      activityIndicator,
    });
    expect(status.dataset.speakerRole).toBe("Guide");
    expect(status.setAttribute).toHaveBeenLastCalledWith(
      "aria-label",
      "Guide speaking",
    );

    applyVoiceStatePresentation("ready", "Ready", {
      status,
      activityIndicator,
    });
    expect(status.textContent).toBe("Ready");
    expect(status.dataset.speakerRole).toBeUndefined();
    expect(status.removeAttribute).toHaveBeenCalledWith("aria-label");
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
