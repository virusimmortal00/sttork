import { describe, expect, it } from "vitest";

import {
  activityIndicatorIsVisible,
  activityStateForVoiceState,
  applyCommandCuePresentation,
  applyVoiceStatePresentation,
  authoritativeVoiceStatePresentation,
  commandCueText,
  statusTextForVoiceAudioState,
  visualOperationalStatus,
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
    expect(activityIndicatorIsVisible("guide-speaking")).toBe(false);
    expect(activityIndicatorIsVisible("narrator-speaking")).toBe(false);

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
    const visualStatus = {
      dataset: { state: "processing" },
      hidden: false,
    };
    const visualStatusText = { textContent: "Processing" as string | null };

    applyVoiceStatePresentation("processing", "Processing", {
      status,
      activityIndicator,
      visualStatus,
      visualStatusText,
    });

    expect(textWrites).toBe(0);
    expect(hiddenWrites).toBe(0);
    expect(activityIndicator.dataset.state).toBe("processing");

    applyVoiceStatePresentation("ready", "Ready", {
      status,
      activityIndicator,
      visualStatus,
      visualStatusText,
    });
    expect(currentText).toBe("Ready");
    expect(textWrites).toBe(1);
    expect(activityIndicator.dataset.state).toBe("idle");
    expect(currentHidden).toBe(true);
    expect(hiddenWrites).toBe(1);
    expect(visualStatus.hidden).toBe(true);
    expect(visualStatusText.textContent).toBe("");

    applyVoiceStatePresentation("ready", "Ready", {
      status,
      activityIndicator,
      visualStatus,
      visualStatusText,
    });
    expect(textWrites).toBe(1);
    expect(hiddenWrites).toBe(1);

    applyVoiceStatePresentation("processing", "Processing", {
      status,
      activityIndicator,
      visualStatus,
      visualStatusText,
    });
    expect(currentText).toBe("Processing");
    expect(textWrites).toBe(2);
    expect(activityIndicator.dataset.state).toBe("processing");
    expect(currentHidden).toBe(false);
    expect(hiddenWrites).toBe(2);
    expect(visualStatus.hidden).toBe(false);
    expect(visualStatusText.textContent).toBe("Processing");
  });

  it("keeps speaking status accessible without a redundant visual status", () => {
    const status = {
      textContent: "Processing" as string | null,
    };
    const activityIndicator = {
      dataset: {} as { state?: string },
      hidden: true,
    };
    const visualStatus = {
      dataset: {} as { state?: string },
      hidden: false,
    };
    const visualStatusText = { textContent: "Processing" as string | null };

    applyVoiceStatePresentation("narrator-speaking", "Narrator speaking", {
      status,
      activityIndicator,
      visualStatus,
      visualStatusText,
    });
    expect(status.textContent).toBe("Narrator speaking");
    expect(activityIndicator.hidden).toBe(true);
    expect(visualStatus.hidden).toBe(true);
    expect(visualStatusText.textContent).toBe("");

    applyVoiceStatePresentation("guide-speaking", "Guide speaking", {
      status,
      activityIndicator,
      visualStatus,
      visualStatusText,
    });
    expect(status.textContent).toBe("Guide speaking");

    applyVoiceStatePresentation("ready", "Ready", {
      status,
      activityIndicator,
      visualStatus,
      visualStatusText,
    });
    expect(status.textContent).toBe("Ready");
  });

  it("projects only processing work into the subordinate visual status", () => {
    expect(visualOperationalStatus("processing", "Processing")).toEqual({
      visible: true,
      text: "Processing",
    });
    expect(visualOperationalStatus("reconnecting", "Reconnecting")).toEqual({
      visible: true,
      text: "Reconnecting",
    });
    expect(
      visualOperationalStatus("narrator-speaking", "Narrator speaking"),
    ).toEqual({ visible: false, text: "" });
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
