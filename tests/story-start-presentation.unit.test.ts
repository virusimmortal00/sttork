import { describe, expect, it, vi } from "vitest";

import {
  applyStoryStartPresentation,
  openingActivationFailureDisposition,
  openingPreparationDisposition,
} from "../apps/web/src/story-start-presentation.js";

function elements() {
  return {
    shell: { dataset: {} as { storyPhase?: string } },
    primaryButton: {
      textContent: "SPEAK",
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

  it("offers an introduction action even without a microphone", () => {
    const subject = elements();

    applyStoryStartPresentation("welcome", "ready", false, subject);

    expect(subject.primaryButton.textContent).toBe("ENTER");
    expect(subject.primaryButton.setAttribute).toHaveBeenCalledWith(
      "aria-label",
      "Meet your guide and narrator",
    );
    expect(subject.shell.dataset.storyPhase).toBe("welcome");
    expect(subject.primaryButton.disabled).toBe(false);
    expect(subject.primaryButton.removeAttribute).toHaveBeenCalledWith(
      "aria-pressed",
    );
    expect(subject.stopButton.disabled).toBe(true);
    expect(subject.textInput.disabled).toBe(true);
    expect(subject.primaryCue.textContent).toBe("");
  });

  it("allows Stop while the role introduction plays", () => {
    const subject = elements();

    applyStoryStartPresentation("introducing", "guide-speaking", true, subject);

    expect(subject.primaryButton.textContent).toBe("LISTEN");
    expect(subject.primaryButton.disabled).toBe(true);
    expect(subject.stopButton.disabled).toBe(false);
    expect(subject.pauseButton.disabled).toBe(true);
  });

  it("presents a distinct story gate after the introduction", () => {
    const subject = elements();

    applyStoryStartPresentation("story-ready", "ready", false, subject);

    expect(subject.primaryButton.textContent).toBe("THE STORY BEGINS");
    expect(subject.primaryButton.disabled).toBe(false);
    expect(subject.stopButton.disabled).toBe(true);
    expect(subject.primaryCue.textContent).toBe("Begin the adventure.");
  });

  it("allows Stop but no second activation while the opening is playing", () => {
    const subject = elements();

    applyStoryStartPresentation("starting", "narrator-speaking", true, subject);

    expect(subject.primaryButton.textContent).toBe("THE STORY BEGINS");
    expect(subject.shell.dataset.storyPhase).toBe("starting");
    expect(subject.primaryButton.disabled).toBe(true);
    expect(subject.stopButton.disabled).toBe(false);
    expect(subject.pauseButton.disabled).toBe(true);
    expect(subject.repeatButton.disabled).toBe(true);
  });

  it("becomes the ordinary capture control only after the opening terminal", () => {
    const subject = elements();

    applyStoryStartPresentation("started", "ready", true, subject);

    expect(subject.primaryButton.textContent).toBe("SPEAK");
    expect(subject.primaryButton.setAttribute).toHaveBeenCalledWith(
      "aria-label",
      "Start speaking",
    );
    expect(subject.shell.dataset.storyPhase).toBe("started");
    expect(subject.primaryButton.disabled).toBe(false);
    expect(subject.primaryButton.setAttribute).toHaveBeenCalledWith(
      "aria-pressed",
      "false",
    );
    expect(subject.stopButton.disabled).toBe(true);
    expect(subject.pauseButton.disabled).toBe(true);
    expect(subject.repeatButton.disabled).toBe(false);
    expect(subject.textInput.disabled).toBe(false);
    expect(subject.primaryCue.textContent).toBe("or press V");

    applyStoryStartPresentation("started", "listening", true, subject);
    expect(subject.primaryButton.textContent).toBe("DONE");
    expect(subject.primaryButton.setAttribute).toHaveBeenCalledWith(
      "aria-label",
      "Finish speaking",
    );
    expect(subject.primaryButton.setAttribute).toHaveBeenLastCalledWith(
      "aria-pressed",
      "true",
    );
    expect(subject.stopButton.disabled).toBe(false);
    expect(subject.pauseButton.disabled).toBe(false);
    expect(subject.repeatButton.disabled).toBe(true);
    expect(subject.textInput.disabled).toBe(true);
  });

  it("shows only Resume while the session is paused", () => {
    const subject = elements();

    applyStoryStartPresentation("started", "paused", true, subject);

    expect(subject.stopButton.disabled).toBe(true);
    expect(subject.pauseButton.disabled).toBe(false);
    expect(subject.repeatButton.disabled).toBe(true);
  });
});
