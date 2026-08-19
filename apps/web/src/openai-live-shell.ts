import {
  ScriptedNarrationPort,
  VoiceAudioController,
  type VoiceAudioState,
} from "../../../packages/audio/src/index.js";
import {
  createOpeningObjectProjection,
  projectOpeningObjectsFromEngineOutput,
  projectOpeningObjectsFromEvent,
} from "../../../packages/command-knowledge/src/index.js";
import type { SemanticEvent } from "../../../packages/contracts/src/index.js";
import { EventSequence } from "../../../packages/events/src/index.js";
import {
  initialExperienceProjection,
  reduceExperienceProjection,
  type ExperienceProjectionState,
} from "../../../packages/experience/src/index.js";
import { SemanticTurnCoordinator } from "../../../packages/session/src/index.js";
import {
  BrowserDorkWorkerFactory,
  type DorkBrowserWorkerLike,
} from "../../../spikes/dork-worker/browser-worker-transport.js";
import { DORK_WORKER_BINDING } from "../../../spikes/dork-worker/dork-worker-binding.js";
import { DorkWorkerEngine } from "../../../spikes/dork-worker/dork-worker-engine.js";

import {
  BrowserMicrophoneCapturePort,
  InMemoryCapturedAudioStore,
  OpenAiLiveGuideModel,
  OpenAiLivePlaybackPort,
  OpenAiLiveTranscriber,
} from "./openai-live-audio.js";

const STORY_ID = "zork1-release-119";
const STORY_SHA256 =
  "37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79";
const STORY_URL = "/vendor/zork1/zork1.z3";
const LIVE_CAPTURE_MEDIA_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

export type LiveStartupErrorCode =
  | "secure-context-required"
  | "browser-cryptography-unavailable"
  | "microphone-unavailable"
  | "audio-recording-unavailable"
  | "startup-failed";

export interface LiveBrowserCapabilities {
  readonly isSecureContext: boolean;
  readonly subtle: unknown;
  readonly getUserMedia: unknown;
  readonly mediaRecorder: unknown;
  readonly supportedCaptureMediaType: boolean;
}

export interface LiveBrowserPreflight {
  readonly readiness: "ready" | "degraded" | "failed";
  readonly secureContext: boolean;
  readonly voiceAvailable: boolean;
  readonly storyAuthenticationAvailable: boolean;
  readonly audioRecordingAvailable: boolean;
  readonly errorCode?: Exclude<LiveStartupErrorCode, "startup-failed">;
  readonly statusText: string;
}

interface LiveSmokeEvidence {
  status: "starting" | "ready" | "degraded" | "failed";
  secureContext: boolean;
  voiceAvailable: boolean;
  storyAuthenticationAvailable: boolean;
  audioRecordingAvailable: boolean;
  turns: number;
  finalRevision: number;
  eventTypes: readonly string[];
  transcriptHidden: boolean;
  debugHidden: boolean;
  workerEnvironment?: {
    readonly workerGlobalScope: boolean;
    readonly documentAbsent: boolean;
    readonly windowAbsent: boolean;
  };
  errorCode?: LiveStartupErrorCode;
}

declare global {
  interface Window {
    __OPENAI_LIVE_SMOKE__?: LiveSmokeEvidence;
  }
}

interface DisableableControl {
  disabled: boolean;
}

interface LiveStatusElement {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
}

export interface LivePreflightPresentationElements {
  readonly status: LiveStatusElement;
  readonly captureButton: DisableableControl;
  readonly transcriptPanel: { hidden: boolean | string };
  readonly transcriptButton: {
    setAttribute(name: string, value: string): void;
  };
  readonly textForm: { hidden: boolean | string };
  readonly textInput: DisableableControl;
  readonly allControls: readonly DisableableControl[];
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element as T;
}

function hasSubtleCrypto(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "digest" in value &&
    typeof value.digest === "function"
  );
}

export function evaluateLiveBrowserPreflight(
  capabilities: LiveBrowserCapabilities,
): LiveBrowserPreflight {
  const storyAuthenticationAvailable = hasSubtleCrypto(capabilities.subtle);
  const audioRecordingAvailable =
    typeof capabilities.mediaRecorder === "function" &&
    capabilities.supportedCaptureMediaType;
  if (!capabilities.isSecureContext) {
    return {
      readiness: storyAuthenticationAvailable ? "degraded" : "failed",
      secureContext: false,
      voiceAvailable: false,
      storyAuthenticationAvailable,
      audioRecordingAvailable,
      errorCode: "secure-context-required",
      statusText: storyAuthenticationAvailable
        ? "Secure connection required for microphone. Use accessible text input."
        : "Secure connection required. Open this page over HTTPS in a supported browser.",
    };
  }
  if (!storyAuthenticationAvailable) {
    return {
      readiness: "failed",
      secureContext: true,
      voiceAvailable: false,
      storyAuthenticationAvailable: false,
      audioRecordingAvailable,
      errorCode: "browser-cryptography-unavailable",
      statusText:
        "Browser cryptography unavailable. Open this page in a supported browser.",
    };
  }
  if (typeof capabilities.getUserMedia !== "function") {
    return {
      readiness: "degraded",
      secureContext: true,
      voiceAvailable: false,
      storyAuthenticationAvailable: true,
      audioRecordingAvailable,
      errorCode: "microphone-unavailable",
      statusText: "Microphone unavailable. Use accessible text input.",
    };
  }
  if (!audioRecordingAvailable) {
    return {
      readiness: "degraded",
      secureContext: true,
      voiceAvailable: false,
      storyAuthenticationAvailable: true,
      audioRecordingAvailable: false,
      errorCode: "audio-recording-unavailable",
      statusText: "Audio recording unavailable. Use accessible text input.",
    };
  }
  return {
    readiness: "ready",
    secureContext: true,
    voiceAvailable: true,
    storyAuthenticationAvailable: true,
    audioRecordingAvailable: true,
    statusText: "Ready",
  };
}

export function applyFatalLiveStartupPresentation(
  statusText: string,
  status: LiveStatusElement | null,
  controls: readonly DisableableControl[],
): void {
  if (status !== null) {
    status.textContent = statusText;
    status.setAttribute("role", "alert");
  }
  for (const control of controls) control.disabled = true;
}

export function applyLivePreflightPresentation(
  preflight: LiveBrowserPreflight,
  elements: LivePreflightPresentationElements,
): boolean {
  if (!preflight.storyAuthenticationAvailable) {
    applyFatalLiveStartupPresentation(
      preflight.statusText,
      elements.status,
      elements.allControls,
    );
    return false;
  }

  elements.status.textContent = preflight.statusText;
  elements.captureButton.disabled = !preflight.voiceAvailable;
  if (!preflight.voiceAvailable) {
    elements.transcriptPanel.hidden = false;
    elements.transcriptButton.setAttribute("aria-expanded", "true");
    elements.textForm.hidden = false;
    elements.textInput.disabled = false;
  }
  return true;
}

function hasSupportedCaptureMediaType(value: unknown): boolean {
  if (typeof value !== "function" || !("isTypeSupported" in value)) {
    return false;
  }
  const isTypeSupported = value.isTypeSupported;
  if (typeof isTypeSupported !== "function") return false;
  return LIVE_CAPTURE_MEDIA_TYPES.some((mediaType) => {
    try {
      return isTypeSupported.call(value, mediaType) === true;
    } catch {
      return false;
    }
  });
}

function liveBrowserPreflight(): LiveBrowserPreflight {
  const scope = globalThis as typeof globalThis & {
    readonly isSecureContext?: boolean;
    readonly MediaRecorder?: unknown;
  };
  return evaluateLiveBrowserPreflight({
    isSecureContext: scope.isSecureContext === true,
    subtle: scope.crypto?.subtle,
    getUserMedia: scope.navigator?.mediaDevices?.getUserMedia,
    mediaRecorder: scope.MediaRecorder,
    supportedCaptureMediaType: hasSupportedCaptureMediaType(
      scope.MediaRecorder,
    ),
  });
}

function sessionToken(): string {
  const token = document
    .querySelector<HTMLMetaElement>('meta[name="zork-voice-live-session"]')
    ?.content.trim();
  if (
    token === undefined ||
    token.length < 32 ||
    token.length > 160 ||
    !/^[A-Za-z0-9_-]+$/u.test(token)
  ) {
    throw new Error("Live session initialization failed.");
  }
  return token;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function run(): Promise<void> {
  const status = required<HTMLElement>("status");
  const captureButton = required<HTMLButtonElement>("capture");
  const stopButton = required<HTMLButtonElement>("stop");
  const pauseButton = required<HTMLButtonElement>("pause");
  const repeatButton = required<HTMLButtonElement>("repeat");
  const transcriptButton = required<HTMLButtonElement>("toggle-transcript");
  const debugButton = required<HTMLButtonElement>("toggle-debug");
  const transcriptPanel = required<HTMLElement>("transcript-panel");
  const transcriptList = required<HTMLOListElement>("transcript-list");
  const debugPanel = required<HTMLElement>("debug-panel");
  const textForm = required<HTMLFormElement>("text-form");
  const textInput = required<HTMLInputElement>("text-input");
  const allControls = Array.from(
    document.querySelectorAll<
      | HTMLButtonElement
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
    >("button, input, select, textarea"),
  );
  const presentation: LivePreflightPresentationElements = {
    status,
    captureButton,
    transcriptPanel,
    transcriptButton,
    textForm,
    textInput,
    allControls,
  };
  const preflight = liveBrowserPreflight();

  function publishEvidence(evidence: LiveSmokeEvidence): void {
    window.__OPENAI_LIVE_SMOKE__ = evidence;
    document.body.dataset.smokeEvidence = JSON.stringify(evidence);
  }

  if (!preflight.storyAuthenticationAvailable) {
    applyLivePreflightPresentation(preflight, presentation);
    publishEvidence({
      status: "failed",
      secureContext: preflight.secureContext,
      voiceAvailable: false,
      storyAuthenticationAvailable: false,
      audioRecordingAvailable: preflight.audioRecordingAvailable,
      turns: 0,
      finalRevision: 0,
      eventTypes: [],
      transcriptHidden: transcriptPanel.hidden !== false,
      debugHidden: debugPanel.hidden !== false,
      errorCode: preflight.errorCode ?? "secure-context-required",
    });
    return;
  }
  const token = sessionToken();

  const storyResponse = await fetch(STORY_URL, { cache: "no-store" });
  if (!storyResponse.ok) throw new Error("Story fetch failed.");
  const storyBytes = new Uint8Array(await storyResponse.arrayBuffer());
  if ((await sha256(storyBytes)) !== STORY_SHA256) {
    throw new Error("Story authentication failed.");
  }

  let workerCount = 0;
  let initialization = 0;
  let message = 0;
  const factory = new BrowserDorkWorkerFactory({
    createWorker: () => {
      workerCount += 1;
      return new Worker("/worker/spikes/dork-worker/browser-worker-entry.js", {
        type: "module",
        name: `openai-live-dork-${workerCount}`,
      }) as unknown as DorkBrowserWorkerLike;
    },
    nextInitializationId: () => `initialize-${++initialization}`,
  });
  const engine = new DorkWorkerEngine({
    factory,
    storyBytes,
    binding: DORK_WORKER_BINDING,
    nextMessageId: () => `message-${++message}`,
  });
  await engine.boot({ storyId: STORY_ID, artifactSha256: STORY_SHA256 });
  let observedObjectProjection = projectOpeningObjectsFromEngineOutput(
    createOpeningObjectProjection(),
    (await engine.inspectPublicState()).lastOutput,
  );

  let projection: ExperienceProjectionState = initialExperienceProjection();
  const canonicalEvents: SemanticEvent[] = [];
  let turns = 0;
  let eventId = 0;
  let requestId = 0;
  let narrationId = 0;
  let interactionId = 0;
  let captureId = 0;
  const narration = new ScriptedNarrationPort();
  const capturedAudio = new InMemoryCapturedAudioStore();
  const capture = new BrowserMicrophoneCapturePort({ store: capturedAudio });
  const transcriber = new OpenAiLiveTranscriber({
    store: capturedAudio,
    sessionToken: token,
  });
  const guide = new OpenAiLiveGuideModel({ sessionToken: token });
  const playback = new OpenAiLivePlaybackPort({ sessionToken: token });

  function renderProjection(): void {
    status.textContent = projection.statusText;
    transcriptList.replaceChildren(
      ...projection.transcript.map((item) => {
        const row = document.createElement("li");
        row.dataset.role = item.role;
        row.textContent = `${item.role}: ${item.text}`;
        return row;
      }),
    );
    debugPanel.textContent = JSON.stringify(
      {
        throughSequence: projection.throughSequence,
        events: projection.debug,
      },
      null,
      2,
    );
  }

  function publish(event: SemanticEvent): void {
    observedObjectProjection = projectOpeningObjectsFromEvent(
      observedObjectProjection,
      event,
    );
    canonicalEvents.push(event);
    projection = reduceExperienceProjection(projection, event);
    renderProjection();
  }

  const coordinator = new SemanticTurnCoordinator({
    engine,
    guide,
    narrator: narration,
    events: new EventSequence({
      sessionId: "openai-live-session",
      now: () => new Date(Date.now()).toISOString(),
      nextId: () => `event-${++eventId}`,
    }),
    nextRequestId: () => `request-${++requestId}`,
    nextNarrationId: () => `narration-${++narrationId}`,
    publish,
  });

  const controller = new VoiceAudioController({
    turns: coordinator,
    capture,
    transcriber,
    narration,
    playback,
    nextInteractionId: () => `interaction-${++interactionId}`,
    nextCaptureId: () => `capture-${++captureId}`,
    observedObjects: () => observedObjectProjection.observedObjects,
    onState: (state: VoiceAudioState) => {
      captureButton.textContent =
        state === "listening" ? "Finish speaking" : "Start speaking";
      captureButton.setAttribute("aria-pressed", String(state === "listening"));
      captureButton.disabled =
        !preflight.voiceAvailable ||
        state === "requesting-microphone" ||
        state === "processing" ||
        state === "guide-speaking" ||
        state === "narrator-speaking" ||
        state === "paused";
      pauseButton.textContent = state === "paused" ? "Resume" : "Pause";
      if (state === "ready") status.textContent = preflight.statusText;
      if (state === "requesting-microphone") {
        status.textContent = "Requesting microphone";
      }
      if (state === "listening") status.textContent = "Listening";
      if (state === "processing") status.textContent = "Processing";
      if (state === "guide-speaking") status.textContent = "Guide speaking";
      if (state === "narrator-speaking") status.textContent = "Narrating";
      if (state === "recoverable-error") {
        status.textContent = "Try again or use text input";
        transcriptPanel.hidden = false;
        transcriptButton.setAttribute("aria-expanded", "true");
        textInput.focus();
      }
    },
    onTurn: () => {
      turns += 1;
    },
  });

  async function updateEvidence(): Promise<void> {
    const state = await engine.inspectPublicState();
    publishEvidence({
      status: preflight.readiness,
      secureContext: preflight.secureContext,
      voiceAvailable: preflight.voiceAvailable,
      storyAuthenticationAvailable: preflight.storyAuthenticationAvailable,
      audioRecordingAvailable: preflight.audioRecordingAvailable,
      turns,
      finalRevision: state.revision,
      eventTypes: canonicalEvents.map((event) => event.type),
      transcriptHidden: transcriptPanel.hidden !== false,
      debugHidden: debugPanel.hidden !== false,
      ...(factory.lastEnvironment === undefined
        ? {}
        : { workerEnvironment: factory.lastEnvironment }),
      ...(preflight.errorCode === undefined
        ? {}
        : { errorCode: preflight.errorCode }),
    });
  }

  async function toggleCapture(): Promise<void> {
    if (!preflight.voiceAvailable) {
      applyLivePreflightPresentation(preflight, presentation);
      textInput.focus();
      return;
    }
    if (controller.state === "listening") {
      await controller.finishCapture();
      await updateEvidence();
    } else if (
      controller.state === "ready" ||
      controller.state === "recoverable-error"
    ) {
      await controller.startCapture();
    }
  }

  function runControl(operation: () => Promise<unknown>): void {
    void operation().catch(() => {
      status.textContent = "Try again";
    });
  }

  projection = {
    ...projection,
    displayState: "ready",
    statusText: preflight.statusText,
  };
  renderProjection();
  applyLivePreflightPresentation(preflight, presentation);
  await updateEvidence();

  captureButton.addEventListener("click", () => runControl(toggleCapture));
  stopButton.addEventListener("click", () =>
    runControl(async () => {
      await controller.stop();
      await updateEvidence();
    }),
  );
  pauseButton.addEventListener("click", () =>
    runControl(async () => {
      if (controller.state === "paused") await controller.resume();
      else await controller.pause();
      await updateEvidence();
    }),
  );
  repeatButton.addEventListener("click", () =>
    runControl(async () => {
      await controller.repeat();
      await updateEvidence();
    }),
  );
  transcriptButton.addEventListener("click", () => {
    transcriptPanel.hidden = !transcriptPanel.hidden;
    transcriptButton.setAttribute(
      "aria-expanded",
      String(!transcriptPanel.hidden),
    );
    runControl(updateEvidence);
  });
  debugButton.addEventListener("click", () => {
    debugPanel.hidden = !debugPanel.hidden;
    debugButton.setAttribute("aria-expanded", String(!debugPanel.hidden));
    runControl(updateEvidence);
  });
  textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textInput.value;
    textInput.value = "";
    runControl(async () => {
      await controller.submitText(text);
      await updateEvidence();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.code === "KeyV" &&
      !event.repeat &&
      event.target === document.body
    ) {
      event.preventDefault();
      runControl(toggleCapture);
    }
    if (event.code === "Escape") runControl(() => controller.stop());
  });
}

function publishStartupFailure(): void {
  const preflight = liveBrowserPreflight();
  const status = document.getElementById("status");
  const controls = Array.from(
    document.querySelectorAll<
      | HTMLButtonElement
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
    >("button, input, select, textarea"),
  );
  applyFatalLiveStartupPresentation("Unable to start", status, controls);
  const transcriptPanel = document.getElementById("transcript-panel");
  const debugPanel = document.getElementById("debug-panel");
  const evidence: LiveSmokeEvidence = {
    status: "failed",
    secureContext: preflight.secureContext,
    voiceAvailable: preflight.voiceAvailable,
    storyAuthenticationAvailable: preflight.storyAuthenticationAvailable,
    audioRecordingAvailable: preflight.audioRecordingAvailable,
    turns: 0,
    finalRevision: 0,
    eventTypes: [],
    transcriptHidden: transcriptPanel?.hidden !== false,
    debugHidden: debugPanel?.hidden !== false,
    errorCode: "startup-failed",
  };
  window.__OPENAI_LIVE_SMOKE__ = evidence;
  document.body.dataset.smokeEvidence = JSON.stringify(evidence);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void run().catch(publishStartupFailure);
}
