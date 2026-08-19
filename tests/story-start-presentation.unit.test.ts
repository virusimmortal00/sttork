import { describe, expect, it, vi } from "vitest";

import {
  applyStoryStartPresentation,
  openingActivationFailureDisposition,
  openingPreparationDisposition,
} from "../apps/web/src/story-start-presentation.js";

function elements() {
  return {
    primaryButton: {
      textContent: "Start speaking",
      disabled: true,
      setAttribute: vi.fn<(name: string, value: string) => void>(),
      removeAttribute: vi.fn<(name: string) => void>(),
    },
    stopButton: { disabled: false },
    pauseButton: { disabled: false },
    repeatButton: { disabled: false },
    textInput: { disabled: false },
    textSubmitButton: { disabled: false },
    primaryCue: { textContent: "" },
  };
}

describe("story start presentation", () => {
  it("returns a player-stopped pre-output activation to the start gate", () => {
    expect(openingActivationFailureDisposition(true, true)).toBe(
      "player-cancelled",
    );
    expect(openingActivationFailureDisposition(true, false)).toBe("failed");
    expect(openingActivationFailureDisposition(false, true)).toBe("failed");
  });

  it("keeps cancellation retryable without presenting it as a failure", () => {
    expect(openingPreparationDisposition("ready")).toEqual({
      retryAvailable: false,
      failed: false,
    });
    expect(openingPreparationDisposition("cancelled")).toEqual({
      retryAvailable: true,
      failed: false,
    });
    expect(openingPreparationDisposition("failed")).toEqual({
      retryAvailable: true,
      failed: true,
    });
  });

  it("offers one non-capture start action even without a microphone", () => {
    const subject = elements();

    applyStoryStartPresentation("ready", "ready", false, subject);

    expect(subject.primaryButton.textContent).toBe("START STORY");
    expect(subject.primaryButton.disabled).toBe(false);
    expect(subject.primaryButton.removeAttribute).toHaveBeenCalledWith(
      "aria-pressed",
    );
    expect(subject.stopButton.disabled).toBe(true);
    expect(subject.textInput.disabled).toBe(true);
  });

  it("allows Stop but no second activation while the opening is playing", () => {
    const subject = elements();

    applyStoryStartPresentation("starting", "narrator-speaking", true, subject);

    expect(subject.primaryButton.textContent).toBe("START STORY");
    expect(subject.primaryButton.disabled).toBe(true);
    expect(subject.stopButton.disabled).toBe(false);
    expect(subject.pauseButton.disabled).toBe(true);
    expect(subject.repeatButton.disabled).toBe(true);
  });

  it("becomes the ordinary capture control only after the opening terminal", () => {
    const subject = elements();

    applyStoryStartPresentation("started", "ready", true, subject);

    expect(subject.primaryButton.textContent).toBe("Start speaking");
    expect(subject.primaryButton.disabled).toBe(false);
    expect(subject.primaryButton.setAttribute).toHaveBeenCalledWith(
      "aria-pressed",
      "false",
    );
    expect(subject.repeatButton.disabled).toBe(false);
    expect(subject.textInput.disabled).toBe(false);

    applyStoryStartPresentation("started", "listening", true, subject);
    expect(subject.primaryButton.textContent).toBe("Finish speaking");
    expect(subject.primaryButton.setAttribute).toHaveBeenLastCalledWith(
      "aria-pressed",
      "true",
    );
    expect(subject.textInput.disabled).toBe(true);
  });
});
