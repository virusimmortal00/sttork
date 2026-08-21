import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../", import.meta.url);

describe("voice shell accessibility markup", () => {
  it("keeps heading semantics and exposes stable, non-duplicated status cues", async () => {
    for (const path of [
      "apps/web/openai-live-smoke.html",
      "apps/web/voice-shell-smoke.html",
    ]) {
      const html = await readFile(new URL(path, repositoryRoot), "utf8");
      expect(html).toContain("<title>STTork</title>");
      expect(html).toMatch(
        /<body>\s*<header class="app-header">\s*<p class="eyebrow">STTork<\/p>\s*<\/header>\s*<main id="voice-shell"/u,
      );
      expect(html).not.toContain("live developer smoke</p>");
      expect(html).toContain(
        '<main id="voice-shell" data-story-phase="booting">',
      );
      expect(html).toMatch(
        /<h1 id="status" aria-live="polite" aria-atomic="true">/u,
      );
      expect(html).toMatch(
        /<div class="status-stage">[\s\S]*?<h1 id="status"[\s\S]*?<div class="status-feedback">/u,
      );
      expect(html).not.toContain('role="status"');
      expect(html).toMatch(
        /id="activity-indicator"[\s\S]*?aria-hidden="true"/u,
      );
      expect(html).toMatch(
        /id="command-cue"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/u,
      );
      expect(html).not.toContain('id="action-log"');
      expect(html).toMatch(
        /<button[\s\S]*?id="capture"[\s\S]*?aria-label="Start story"[\s\S]*?disabled[\s\S]*?>[\s\S]*?BEGIN[\s\S]*?<\/button>/u,
      );
      expect(html).not.toMatch(/id="capture"[^>]*aria-pressed=/u);
      expect(html).toMatch(
        /<div class="primary-action">[\s\S]*?<button[\s\S]*?id="capture"[\s\S]*?<p id="primary-cue" class="cue" aria-hidden="true"><\/p>/u,
      );
    }
  });

  it("presents committed commands in the shared visual conversation", async () => {
    for (const path of [
      "apps/web/src/openai-live-shell.ts",
      "apps/web/src/voice-shell-smoke.ts",
    ]) {
      const source = await readFile(new URL(path, repositoryRoot), "utf8");
      expect(source).toMatch(
        /event\.type === "engine\.command\.committed"[\s\S]*?spokenTranscript\.showCommand\(event\.payload\.command\)/u,
      );
      expect(source).not.toMatch(
        /event\.type === "engine\.command\.requested"[\s\S]{0,160}?spokenTranscript\.showCommand/u,
      );
    }
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(
      /\.spoken-line\[data-role="command"\] \{[\s\S]*?display: block;[\s\S]*?color: #e6cc82;[\s\S]*?font-size: clamp\(1\.4rem, 3\.8vw, 1\.9rem\);[\s\S]*?text-align: center;/u,
    );
    expect(css).toMatch(
      /\.spoken-line\[data-role="command"\]::before \{\s*content: none;/u,
    );
    expect(css).toMatch(
      /\.spoken-history li\[data-role="command"\]::before \{\s*color: #e6cc82;/u,
    );
    expect(css).toMatch(
      /\.spoken-line\[data-role="command"\] \.spoken-word \{[\s\S]*?animation: command-focus-arrive 360ms/u,
    );
    expect(css).toContain("--action-accent: #c4add6;");
    expect(css).toMatch(
      /\.spoken-line\[data-role="action"\]::before,[\s\S]*?\.spoken-history li\[data-role="action"\]::before \{[\s\S]*?color: var\(--action-accent\);/u,
    );
    expect(css).toMatch(
      /\.spoken-line\[data-role="action"\] \.spoken-word \{[\s\S]*?animation: command-focus-arrive 360ms/u,
    );
    expect(css).toMatch(
      /\.spoken-history li\[data-role="command"\] \{[\s\S]*?color: rgb\(216 197 139 \/ 58%\);/u,
    );
    expect(css).not.toContain(".action-log");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none !important;/u,
    );
    expect(css).toMatch(
      /#voice-shell:has\(\.activity-indicator\[data-state="idle"\]\) #status/u,
    );
  });

  it("focuses final player transcripts in the shared visual conversation", async () => {
    for (const path of [
      "apps/web/src/openai-live-shell.ts",
      "apps/web/src/voice-shell-smoke.ts",
    ]) {
      const source = await readFile(new URL(path, repositoryRoot), "utf8");
      expect(source).toMatch(
        /event\.type === "transcript\.final"[\s\S]*?spokenTranscript\.showPlayer\(event\.payload\.text\)/u,
      );
    }
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toContain("--player-accent: #d7a06b;");
    expect(css).toMatch(
      /\.spoken-line\[data-role="player"\]::before,[\s\S]*?\.spoken-history li\[data-role="player"\]::before \{[\s\S]*?color: var\(--player-accent\);/u,
    );
  });

  it("pauses and resumes progressive text with the playback session", async () => {
    for (const path of [
      "apps/web/src/openai-live-shell.ts",
      "apps/web/src/voice-shell-smoke.ts",
    ]) {
      const source = await readFile(new URL(path, repositoryRoot), "utf8");
      expect(source).toMatch(
        /event\.type === "session\.paused"[\s\S]*?spokenTranscript\.pause\(\)[\s\S]*?event\.type === "session\.resumed"[\s\S]*?spokenTranscript\.resume\(\)/u,
      );
    }
  });

  it("distinguishes Guide attribution with a muted blue role accent", async () => {
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toContain("--guide-accent: #a7cbe0;");
    expect(css).not.toContain("data-speaker-role");
    expect(css).toMatch(
      /\.spoken-line\[data-role="guide"\]::before,[\s\S]*?\.spoken-history li\[data-role="guide"\]::before \{[\s\S]*?color: var\(--guide-accent\);/u,
    );
  });

  it("separates contextual playback actions from optional utilities", async () => {
    for (const path of [
      "apps/web/openai-live-smoke.html",
      "apps/web/voice-shell-smoke.html",
    ]) {
      const html = await readFile(new URL(path, repositoryRoot), "utf8");
      expect(html).toMatch(
        /<nav class="conversation-actions" aria-label="Conversation playback">[\s\S]*?id="stop"[\s\S]*?aria-label="Stop playback"[\s\S]*?■[\s\S]*?id="repeat"[\s\S]*?aria-label="Repeat last narration"[\s\S]*?↻/u,
      );
      expect(html).toMatch(
        /id="visual-status"[\s\S]*?id="story-gate"[\s\S]*?THE STORY BEGINS[\s\S]*?id="idle-prompt"[\s\S]*?What will you do\?[\s\S]*?<nav class="conversation-actions" aria-label="Conversation playback">[\s\S]*?id="stop"[\s\S]*?id="repeat"[\s\S]*?id="spoken-history"/u,
      );
      expect(html).not.toContain('id="pause"');
      expect(html).toMatch(
        /<\/main>\s*<footer class="app-footer">[\s\S]*?<nav class="utility-actions" aria-label="More options"/u,
      );
      expect(html).toMatch(
        /id="transcript-panel"[\s\S]*?aria-modal="true"[\s\S]*?id="close-transcript"/u,
      );
      expect(html).toMatch(
        /id="copy-transcript"[\s\S]*?aria-label="Copy transcript to clipboard"[\s\S]*?title="Copy transcript"[\s\S]*?disabled/u,
      );
      expect(html).toMatch(
        /id="copy-transcript-status"[\s\S]*?aria-live="polite"/u,
      );
      expect(html).toMatch(
        /id="debug-panel"[\s\S]*?aria-modal="true"[\s\S]*?id="close-debug"[\s\S]*?id="debug-content"/u,
      );
      expect(html).toMatch(
        /id="transcript-older"[\s\S]*?id="transcript-page-status"[\s\S]*?id="transcript-newer"/u,
      );
      expect(html).toMatch(
        /id="debug-older"[\s\S]*?id="debug-page-status"[\s\S]*?id="debug-newer"/u,
      );
      expect(html).not.toMatch(/id="transcript-panel"[\s\S]*?id="text-form"/u);
    }
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(
      /\.conversation-actions button:disabled \{\s*display: none;/u,
    );
    expect(css).toMatch(/\.utility-actions \{[\s\S]*?border-radius: 999px;/u);
    expect(css).toMatch(/\.app-footer \{[\s\S]*?position: fixed;/u);
    expect(css).toMatch(/dialog\.utility-modal \{[\s\S]*?opacity: 0;/u);
    expect(css).toMatch(
      /\.utility-modal \.modal-icon-button svg \{[\s\S]*?stroke: currentcolor;/u,
    );
  });

  it("offers mutually exclusive Voice and Text transports on the play surface", async () => {
    for (const path of [
      "apps/web/openai-live-smoke.html",
      "apps/web/voice-shell-smoke.html",
    ]) {
      const html = await readFile(new URL(path, repositoryRoot), "utf8");
      expect(html).toMatch(
        /class="primary-action"[\s\S]*?class="input-control-row"[\s\S]*?id="input-mode-switch"[\s\S]*?role="group"[\s\S]*?aria-label="Input mode"/u,
      );
      expect(html).toMatch(
        /id="voice-mode"[\s\S]*?aria-label="Use voice input"[\s\S]*?aria-pressed="true"[\s\S]*?<svg[\s\S]*?id="text-mode"[\s\S]*?aria-label="Use text input"[\s\S]*?aria-pressed="false"[\s\S]*?<svg/u,
      );
      expect(html).toMatch(
        /id="text-form" class="text-composer" hidden[\s\S]*?<textarea[\s\S]*?id="text-input"[\s\S]*?placeholder="Tell the Guide what you want to do…"[\s\S]*?id="text-submit"[\s\S]*?aria-label="Send message"/u,
      );
      expect(html).toMatch(
        /id="spoken-line"[\s\S]*?id="idle-prompt"[\s\S]*?id="voice-waveform"[\s\S]*?aria-hidden="true"[\s\S]*?hidden[\s\S]*?id="spoken-history"[\s\S]*?class="primary-action"/u,
      );
    }
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(
      /\.input-mode-switch button\[aria-pressed="true"\] \{/u,
    );
    expect(css).toMatch(
      /\.text-composer \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/u,
    );
    expect(css).toMatch(
      /\.input-transport \{[\s\S]*?min-height: 5\.8rem;[\s\S]*?justify-content: center;/u,
    );
    expect(css).toMatch(
      /\.input-control-row:has\(\.input-mode-switch:not\(\[hidden\]\)\) \{\s*transform: translateX\(2\.475rem\);/u,
    );
  });

  it("warms the deterministic opening only after narrator introduction begins", async () => {
    const source = await readFile(
      new URL("apps/web/src/openai-live-shell.ts", repositoryRoot),
      "utf8",
    );
    expect(source).toMatch(
      /storyStartPhase === "introducing"[\s\S]*?state === "narrator-speaking"[\s\S]*?deterministicOpeningPrefetchRequests\(openingNarrationText\)[\s\S]*?playback\.prepare\(request, signal\)/u,
    );
  });

  it("keeps a visual narrator line and bounded muted history separate from the accessible transcript", async () => {
    for (const path of [
      "apps/web/openai-live-smoke.html",
      "apps/web/voice-shell-smoke.html",
    ]) {
      const html = await readFile(new URL(path, repositoryRoot), "utf8");
      expect(html).toMatch(/id="spoken-transcript"[^>]*hidden/u);
      expect(html).toMatch(
        /id="spoken-line"[^>]*aria-hidden="true"[\s\S]*?id="visual-status"[\s\S]*?aria-hidden="true"[\s\S]*?id="spoken-history"[^>]*aria-hidden="true"/u,
      );
      expect(html).toContain('id="spoken-history"');
    }
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(/\.spoken-word\.is-visible \{[\s\S]*?opacity: 1;/u);
    expect(css).not.toMatch(
      /\.spoken-word \{[^}]*filter:|\.spoken-word\.is-visible \{[^}]*filter:/u,
    );
    expect(css).toMatch(/\.spoken-history \{[\s\S]*?overflow: auto;/u);
    expect(css).toMatch(
      /\.spoken-transcript \{[\s\S]*?--active-stage-min-height: clamp\(18rem, 42vh, 36rem\);[\s\S]*?height: 100%;[\s\S]*?min-height: 0;[\s\S]*?grid-template-rows: minmax\(var\(--active-stage-min-height\), 1fr\) auto auto auto;[\s\S]*?row-gap: 0;/u,
    );
    expect(css).toMatch(
      /#voice-shell:has\(\.spoken-transcript:not\(\[hidden\]\)\) \{[\s\S]*?height: calc\(100dvh - 6rem\);[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\) auto;/u,
    );
    expect(css).toMatch(
      /\.spoken-transcript \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/u,
    );
    expect(css).toMatch(
      /\.spoken-transcript \{[\s\S]*?--conversation-width: min\(50rem, calc\(100vw - 2rem\)\);[\s\S]*?margin: 0\.35rem calc\(\(100% - var\(--conversation-width\)\) \/ 2\) 0\.8rem;/u,
    );
    expect(css).toMatch(
      /\.spoken-history \{[\s\S]*?width: 100%;[\s\S]*?max-width: 50rem;[\s\S]*?height: 6\.5rem;[\s\S]*?max-height: 6\.5rem;/u,
    );
    expect(css).toMatch(
      /\.spoken-history \{[\s\S]*?opacity: 1;[\s\S]*?visibility: visible;[\s\S]*?opacity 460ms cubic-bezier\(0\.37, 0, 0\.63, 1\)/u,
    );
    expect(css).toMatch(
      /#voice-shell\[data-story-phase="story-ready"\] \.spoken-history \{[\s\S]*?opacity: 0;[\s\S]*?visibility: hidden;[\s\S]*?visibility 0s linear 460ms;/u,
    );
    expect(css).not.toContain(".spoken-transcript:has(.spoken-history:empty)");
    expect(css).toMatch(
      /\.spoken-history:empty \{\s*visibility: hidden;\s*pointer-events: none;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 32rem\) \{[\s\S]*?\.spoken-history \{[\s\S]*?height: 4\.9rem;[\s\S]*?max-height: 4\.9rem;/u,
    );
    expect(css).toMatch(/\.spoken-line:empty \{\s*visibility: hidden;/u);
    expect(css).toMatch(
      /\.spoken-line__content,\s*\.spoken-line::before \{\s*transition: opacity 520ms cubic-bezier\(0\.37, 0, 0\.63, 1\);/u,
    );
    expect(css).toMatch(
      /\.spoken-line\.is-leaving \.spoken-line__content,\s*\.spoken-line\.is-leaving:not\(\.is-speaker-continuing\)::before \{\s*opacity: 0;\s*will-change: opacity;\s*\}/u,
    );
    expect(css).toMatch(
      /\.spoken-history li \{[\s\S]*?animation: spoken-line-settle 300ms/u,
    );
    expect(css).toMatch(
      /@keyframes spoken-line-settle \{[\s\S]*?max-height: 0;[\s\S]*?max-height: 6\.5rem;/u,
    );
    expect(css).toMatch(
      /\.story-gate,[\s\S]*?\.idle-prompt,[\s\S]*?\.voice-waveform \{[\s\S]*?grid-row: 1;/u,
    );
    expect(css).toMatch(
      /\.spoken-transcript:has\(\.spoken-line:not\(:empty\)\) \.story-gate,[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none;/u,
    );
    expect(css).toMatch(
      /\.spoken-line \{[\s\S]*?width: 100%;[\s\S]*?max-width: 50rem;/u,
    );
    expect(css).toMatch(
      /\.spoken-line \{[\s\S]*?max-height: 100%;[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;/u,
    );
    expect(css).toMatch(
      /\.spoken-transcript \{[\s\S]*?width: var\(--conversation-width\);/u,
    );
    expect(css).toMatch(
      /\.spoken-line \{[\s\S]*?grid-template-columns: max-content minmax\(0, 1fr\);[\s\S]*?column-gap: 0\.55em;/u,
    );
    expect(css).toMatch(
      /\.spoken-history li \{[\s\S]*?grid-template-columns: max-content minmax\(0, 1fr\);/u,
    );
    expect(css).toMatch(/\.spoken-history li \{[\s\S]*?color:/u);
    expect(css).toMatch(
      /#voice-shell:has\(\.spoken-transcript:not\(\[hidden\]\)\) \.activity-indicator \{\s*display: none;/u,
    );
    expect(css).toMatch(
      /#voice-shell:has\(\.spoken-transcript:not\(\[hidden\]\)\) \.status-feedback \{\s*min-height: 0;/u,
    );
    expect(css).toMatch(
      /#voice-shell:has\(\.spoken-transcript:not\(\[hidden\]\)\) #status \{[\s\S]*?clip-path: inset\(50%\);/u,
    );
    expect(css).toMatch(
      /\.visual-status \{[\s\S]*?margin-top: 0\.7rem;[\s\S]*?text-transform: uppercase;/u,
    );
    expect(css).toMatch(
      /\.visual-status\[hidden\] \{[\s\S]*?opacity: 0;[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none;/u,
    );
    expect(css).toMatch(
      /\.spoken-transcript:has\(\.spoken-line:not\(:empty\)\) \.visual-status,\s*\.spoken-transcript\[data-playback-state="settling"\] \.visual-status \{[\s\S]*?opacity: 0;[\s\S]*?visibility: hidden;/u,
    );
    expect(css).toMatch(
      /\.visual-status-activity i \{[\s\S]*?animation: processing-dot 1\.05s ease-in-out infinite;/u,
    );
    expect(css).toMatch(
      /\.spoken-history \{[\s\S]*?margin: clamp\(3rem, 8vh, 5rem\) 0 0;/u,
    );
    expect(css).toMatch(
      /\.spoken-transcript\[data-playback-state="settled"\] \{[\s\S]*?min-height: 0;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 32rem\) \{[\s\S]*?body \{\s*min-height: 100svh;[\s\S]*?#voice-shell:has\(\.spoken-transcript:not\(\[hidden\]\)\) \{[\s\S]*?height: calc\(100svh - 8\.75rem\);[\s\S]*?padding-top: clamp\(4\.25rem, 10svh, 5\.5rem\);[\s\S]*?box-sizing: border-box;[\s\S]*?\.input-control-row:has\(\.input-mode-switch:not\(\[hidden\]\)\) \{\s*transform: none;[\s\S]*?\.spoken-transcript,[\s\S]*?--active-stage-min-height: clamp\(10rem, 28svh, 16rem\);[\s\S]*?min-height: 0;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 32rem\) \{[\s\S]*?\.conversation-actions \{\s*margin-top: clamp\(0\.8rem, 2svh, 1\.25rem\);[\s\S]*?\.conversation-actions \+ \.spoken-history \{\s*margin-top: 0\.8rem;/u,
    );
    expect(css).toMatch(
      /body \{[\s\S]*?min-height: 100dvh;[\s\S]*?padding-bottom: calc\(5rem \+ env\(safe-area-inset-bottom\)\);/u,
    );
    expect(css).toMatch(
      /\.app-footer \{[\s\S]*?bottom: calc\(0\.7rem \+ env\(safe-area-inset-bottom\)\);/u,
    );
    expect(css).toMatch(
      /\.app-header \{[\s\S]*?position: fixed;[\s\S]*?top: clamp\(3rem, 10vh, 10rem\);/u,
    );
    expect(css).toMatch(
      /#voice-shell:has\(\.activity-indicator\[data-state="processing"\]\) #status \{[\s\S]*?font-size: 0\.72rem;[\s\S]*?text-transform: uppercase;/u,
    );
  });

  it("keeps voice preferences optional, labeled, and transparent", async () => {
    const html = await readFile(
      new URL("apps/web/openai-live-smoke.html", repositoryRoot),
      "utf8",
    );
    expect(html).toMatch(/id="toggle-settings"[^>]*aria-expanded="false"/u);
    expect(html).toMatch(
      /id="toggle-settings"[^>]*aria-controls="settings-panel"/u,
    );
    expect(html).toMatch(
      /<dialog[\s\S]*?id="settings-panel"[\s\S]*?aria-labelledby="settings-heading"[\s\S]*?aria-modal="true"/u,
    );
    expect(html).toContain('aria-label="Close voice preferences"');
    expect(html).toContain("These are AI-generated voices.");
    expect(html).toContain("Samples make a billable speech request.");
    for (const id of [
      "guide-voice",
      "guide-rate",
      "narrator-voice",
      "narrator-rate",
    ]) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(/dialog\.utility-modal\[open\] \{[\s\S]*?opacity: 1;/u);
    expect(css).toMatch(/dialog\.utility-modal::backdrop \{/u);
    expect(css).toMatch(/dialog\.utility-modal\.is-closing \{/u);
  });

  it("disables every decorative animation for reduced motion", async () => {
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important;/u,
    );
  });

  it("gives the speaking control a restrained waveform treatment", async () => {
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(
      /\.voice-waveform span \{[\s\S]*?animation: voice-level 920ms ease-in-out infinite alternate;/u,
    );
    expect(css).toMatch(
      /\.story-gate,[\s\S]*?\.idle-prompt,[\s\S]*?\.voice-waveform \{[\s\S]*?grid-row: 1;[\s\S]*?justify-self: center;/u,
    );
    expect(css).toMatch(
      /#capture\[aria-pressed\]::before,[\s\S]*?#capture\[aria-pressed\]::after \{\s*content: none;/u,
    );
    expect(css).toMatch(/#capture\[aria-pressed="true"\] \{/u);
    expect(css).toMatch(
      /animation: capture-arrive 820ms cubic-bezier\(0\.16, 1, 0\.3, 1\) 220ms both;/u,
    );
    expect(css).toMatch(/#capture:not\(:disabled\):hover \{/u);
    expect(css).toMatch(/#capture:not\(\[aria-pressed\]\) \{/u);
    expect(css).toMatch(
      /#capture:not\(\[aria-pressed\]\) \{[\s\S]*?min-width: 7\.5rem;[\s\S]*?min-height: 2\.75rem;/u,
    );
    expect(css).toMatch(/#capture:not\(\[aria-pressed\]\)::before,/u);
    expect(css).toMatch(
      /#capture:not\(\[aria-pressed\]\):not\(:disabled\):hover \{/u,
    );
    expect(css).toMatch(
      /animation: threshold-glimmer 1\.8s ease-in-out infinite;/u,
    );
    expect(css).toMatch(
      /#capture:not\(\[aria-pressed\]\):not\(:disabled\):hover \{[\s\S]*?transform: none;/u,
    );
  });

  it("keeps the pre-story wayfinder decorative and motion-optional", async () => {
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(
      /#voice-shell\[data-story-phase="welcome"\] \.status-feedback::before \{/u,
    );
    expect(css).toMatch(
      /#voice-shell\[data-story-phase="welcome"\] #status \{[\s\S]*?transition: none;/u,
    );
    expect(css).toMatch(
      /\.status-stage \{[\s\S]*?transform: translateY\(0\.45rem\);/u,
    );
    expect(css).toMatch(/\.primary-action \{[\s\S]*?margin-top: 0\.3rem;/u);
    expect(css).toMatch(/animation: wayfinder-turn 32s linear infinite;/u);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important;/u,
    );
  });
});
