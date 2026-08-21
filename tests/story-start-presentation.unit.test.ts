import { describe, expect, it, vi } from "vitest";

import {
  applyStoryStartPresentation,
  openingActivationFailureDisposition,
  openingPreparationDisposition,
  textComposerShouldSubmit,
} from "../apps/web/src/story-start-presentation.js";

function elements() {
  return {
    shell: {
      dataset: {} as { storyPhase?: string; inputMode?: string },
    },
    primaryButton: {
      textContent: "SPEAK",
      hidden: false,
      disabled: true,
      setAttribute: vi.fn<(name: string, value: string) => void>(),
      removeAttribute: vi.fn<(name: string) => void>(),
    },
    storyGateButton: { hidden: true, disabled: true },
    idlePrompt: { hidden: true },
    stopButton: {
      disabled: false,
      textContent: "■",
      setAttribute: vi.fn<(name: string, value: string) => void>(),
    },
    repeatButton: { disabled: false },
    inputModeSwitch: { hidden: false },
    voiceModeButton: {
      disabled: false,
      setAttribute: vi.fn<(name: string, value: string) => void>(),
    },
    textModeButton: {
      disabled: false,
      setAttribute: vi.fn<(name: string, value: string) => void>(),
    },
    voiceWaveform: { hidden: false },
    textForm: { hidden: false },
    textInput: { disabled: false },
    textSubmitButton: { disabled: false },
    primaryCue: { textContent: "" },
  };
}

describe("story start presentation", () => {
  it("submits plain Enter while preserving composition and Shift+Enter", () => {
    expect(
      textComposerShouldSubmit({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
    expect(
      textComposerShouldSubmit({
        key: "Enter",
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(false);
    expect(
      textComposerShouldSubmit({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false);
  });

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

    applyStoryStartPresentation("welcome", "ready", false, "text", subject);

    expect(subject.primaryButton.textContent).toBe("ENTER");
    expect(subject.primaryButton.setAttribute).toHaveBeenCalledWith(
      "aria-label",
      "Meet your guide and narrator",
    );
    expect(subject.shell.dataset.storyPhase).toBe("welcome");
    expect(subject.primaryButton.disabled).toBe(false);
    expect(subject.primaryButton.hidden).toBe(false);
    expect(subject.storyGateButton.hidden).toBe(true);
    expect(subject.primaryButton.removeAttribute).toHaveBeenCalledWith(
      "aria-pressed",
    );
    expect(subject.stopButton.disabled).toBe(true);
    expect(subject.textInput.disabled).toBe(true);
    expect(subject.inputModeSwitch.hidden).toBe(true);
    expect(subject.textForm.hidden).toBe(true);
    expect(subject.primaryCue.textContent).toBe("");
  });

  it("removes the inactive primary action while the role introduction plays", () => {
    const subject = elements();

    applyStoryStartPresentation(
      "introducing",
      "guide-speaking",
      true,
      "voice",
      subject,
    );

    expect(subject.primaryButton.textContent).toBe("ENTER");
    expect(subject.primaryButton.hidden).toBe(true);
    expect(subject.storyGateButton.hidden).toBe(true);
    expect(subject.primaryButton.disabled).toBe(true);
    expect(subject.stopButton.disabled).toBe(false);
    expect(subject.stopButton.textContent).toBe("■");
  });

  it("presents a distinct story gate after the introduction", () => {
    const subject = elements();

    applyStoryStartPresentation("story-ready", "ready", false, "text", subject);

    expect(subject.primaryButton.textContent).toBe("ENTER");
    expect(subject.primaryButton.hidden).toBe(true);
    expect(subject.storyGateButton.hidden).toBe(false);
    expect(subject.storyGateButton.disabled).toBe(false);
    expect(subject.stopButton.disabled).toBe(true);
    expect(subject.primaryCue.textContent).toBe("");
  });

  it("allows Stop but no second activation while the opening is playing", () => {
    const subject = elements();

    applyStoryStartPresentation(
      "starting",
      "narrator-speaking",
      true,
      "voice",
      subject,
    );

    expect(subject.primaryButton.textContent).toBe("ENTER");
    expect(subject.shell.dataset.storyPhase).toBe("starting");
    expect(subject.primaryButton.disabled).toBe(true);
    expect(subject.storyGateButton.hidden).toBe(false);
    expect(subject.storyGateButton.disabled).toBe(true);
    expect(subject.stopButton.disabled).toBe(false);
    expect(subject.repeatButton.disabled).toBe(true);
  });

  it("becomes the ordinary capture control only after the opening terminal", () => {
    const subject = elements();

    applyStoryStartPresentation("started", "ready", true, "voice", subject);

    expect(subject.primaryButton.textContent).toBe("SPEAK");
    expect(subject.primaryButton.hidden).toBe(false);
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
    expect(subject.repeatButton.disabled).toBe(false);
    expect(subject.idlePrompt.hidden).toBe(false);
    expect(subject.textInput.disabled).toBe(true);
    expect(subject.inputModeSwitch.hidden).toBe(false);
    expect(subject.textForm.hidden).toBe(true);
    expect(subject.voiceModeButton.setAttribute).toHaveBeenCalledWith(
      "aria-pressed",
      "true",
    );
    expect(subject.primaryCue.textContent).toBe("or press V");

    applyStoryStartPresentation("started", "listening", true, "voice", subject);
    expect(subject.idlePrompt.hidden).toBe(true);
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
    expect(subject.repeatButton.disabled).toBe(true);
    expect(subject.textInput.disabled).toBe(true);
    expect(subject.voiceWaveform.hidden).toBe(false);
  });

  it("replaces capture with the main text composer in text mode", () => {
    const subject = elements();

    applyStoryStartPresentation("started", "ready", true, "text", subject);

    expect(subject.shell.dataset.inputMode).toBe("text");
    expect(subject.primaryButton.hidden).toBe(true);
    expect(subject.textForm.hidden).toBe(false);
    expect(subject.textInput.disabled).toBe(false);
    expect(subject.textSubmitButton.disabled).toBe(false);
    expect(subject.textModeButton.setAttribute).toHaveBeenCalledWith(
      "aria-pressed",
      "true",
    );
    expect(subject.primaryCue.textContent).toBe("Enter to send");
  });

  it("falls back to text mode when microphone capture is unavailable", () => {
    const subject = elements();

    applyStoryStartPresentation("started", "ready", false, "voice", subject);

    expect(subject.shell.dataset.inputMode).toBe("text");
    expect(subject.voiceModeButton.disabled).toBe(true);
    expect(subject.primaryButton.hidden).toBe(true);
    expect(subject.textForm.hidden).toBe(false);
    expect(subject.textInput.disabled).toBe(false);
  });

  it("turns the stop symbol into an accessible Resume while paused", () => {
    const subject = elements();

    applyStoryStartPresentation("started", "paused", true, "voice", subject);

    expect(subject.stopButton.disabled).toBe(false);
    expect(subject.stopButton.textContent).toBe("▶");
    expect(subject.stopButton.setAttribute).toHaveBeenCalledWith(
      "aria-label",
      "Resume playback",
    );
    expect(subject.stopButton.setAttribute).toHaveBeenCalledWith(
      "title",
      "Resume",
    );
    expect(subject.repeatButton.disabled).toBe(true);
  });
});
