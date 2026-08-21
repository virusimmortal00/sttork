import { describe, expect, it, vi } from "vitest";

import {
  applyLivePreflightPresentation,
  evaluateLiveBrowserPreflight,
  type LiveBrowserCapabilities,
  type LivePreflightPresentationElements,
} from "../apps/web/src/openai-live-shell.js";

const subtle = { digest: vi.fn() };
const getUserMedia = vi.fn();
const mediaRecorder = vi.fn();

function capabilities(
  overrides: Partial<LiveBrowserCapabilities> = {},
): LiveBrowserCapabilities {
  return {
    isSecureContext: true,
    subtle,
    getUserMedia,
    mediaRecorder,
    supportedCaptureMediaType: true,
    ...overrides,
  };
}

function presentationElements(): LivePreflightPresentationElements & {
  readonly status: {
    textContent: string | null;
    setAttribute: ReturnType<typeof vi.fn>;
  };
  readonly otherControl: { disabled: boolean };
} {
  const status = {
    textContent: "Starting" as string | null,
    setAttribute: vi.fn(),
  };
  const captureButton = { disabled: false };
  const textInput = { disabled: true, tabIndex: -1 };
  const otherControl = { disabled: false };
  return {
    status,
    captureButton,
    allControls: [captureButton, otherControl, textInput],
    otherControl,
  };
}

describe("OpenAI live browser preflight", () => {
  it("reports a fatal capability state without secure story authentication", () => {
    expect(
      evaluateLiveBrowserPreflight(
        capabilities({ isSecureContext: true, subtle: undefined }),
      ),
    ).toEqual({
      readiness: "failed",
      secureContext: true,
      voiceAvailable: false,
      storyAuthenticationAvailable: false,
      audioRecordingAvailable: true,
      errorCode: "browser-cryptography-unavailable",
      statusText:
        "Browser cryptography unavailable. Open this page in a supported browser.",
    });
  });

  it("reports degraded capability evidence for an insecure context", () => {
    expect(
      evaluateLiveBrowserPreflight(capabilities({ isSecureContext: false })),
    ).toEqual({
      readiness: "degraded",
      secureContext: false,
      voiceAvailable: false,
      storyAuthenticationAvailable: true,
      audioRecordingAvailable: true,
      errorCode: "secure-context-required",
      statusText: "Secure connection required for microphone. Choose Text.",
    });
  });

  it("degrades to text input when microphone capture is unavailable", () => {
    expect(
      evaluateLiveBrowserPreflight(capabilities({ getUserMedia: undefined })),
    ).toEqual({
      readiness: "degraded",
      secureContext: true,
      voiceAvailable: false,
      storyAuthenticationAvailable: true,
      audioRecordingAvailable: true,
      errorCode: "microphone-unavailable",
      statusText: "Microphone unavailable. Choose Text.",
    });
  });

  it("degrades before Ready when MediaRecorder or a capture format is missing", () => {
    for (const overrides of [
      { mediaRecorder: undefined },
      { supportedCaptureMediaType: false },
    ]) {
      expect(
        evaluateLiveBrowserPreflight(capabilities(overrides)),
      ).toMatchObject({
        readiness: "degraded",
        voiceAvailable: false,
        audioRecordingAvailable: false,
        errorCode: "audio-recording-unavailable",
      });
    }
  });

  it("enables voice only when every required browser capability exists", () => {
    expect(evaluateLiveBrowserPreflight(capabilities())).toEqual({
      readiness: "ready",
      secureContext: true,
      voiceAvailable: true,
      storyAuthenticationAvailable: true,
      audioRecordingAvailable: true,
      statusText: "Ready",
    });
  });
});

describe("OpenAI live preflight presentation", () => {
  it("leaves the main experience available while disabling capture", () => {
    const elements = presentationElements();
    const preflight = evaluateLiveBrowserPreflight(
      capabilities({ getUserMedia: undefined }),
    );

    expect(applyLivePreflightPresentation(preflight, elements)).toBe(true);
    expect(elements.status.textContent).toBe(
      "Microphone unavailable. Choose Text.",
    );
    expect(elements.captureButton.disabled).toBe(true);
    expect(elements.otherControl.disabled).toBe(false);
  });

  it("fatally disables every control and prevents listener registration", () => {
    const elements = presentationElements();
    const registerListeners = vi.fn();
    const preflight = evaluateLiveBrowserPreflight(
      capabilities({ subtle: undefined }),
    );

    if (applyLivePreflightPresentation(preflight, elements)) {
      registerListeners();
    }

    expect(registerListeners).not.toHaveBeenCalled();
    expect(elements.status.setAttribute).toHaveBeenCalledWith("role", "alert");
    expect(elements.allControls.every((control) => control.disabled)).toBe(
      true,
    );
  });
});
