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
      expect(html).toMatch(
        /id="action-log"[\s\S]*?role="list"[\s\S]*?aria-label="Recent game commands"[\s\S]*?tabindex="0"[\s\S]*?hidden/u,
      );
      expect(html).not.toMatch(/id="action-log"[^>]*aria-live=/u);
      expect(html).toMatch(
        /<button id="capture" type="button" aria-label="Start story" disabled>[\s\S]*?BEGIN[\s\S]*?<\/button>/u,
      );
      expect(html).not.toMatch(/id="capture"[^>]*aria-pressed=/u);
      expect(html).toMatch(
        /<div class="primary-action">[\s\S]*?<button id="capture"[\s\S]*?<p id="primary-cue" class="cue" aria-hidden="true"><\/p>/u,
      );
    }
  });

  it("keeps recent commands in a compact scrolling visual hierarchy", async () => {
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(/\.action-log \{[\s\S]*?max-height:/u);
    expect(css).toMatch(/\.action-log \{[\s\S]*?overflow-y: auto;/u);
    expect(css).toMatch(
      /\.action-log::before \{[\s\S]*?content: "Recent commands";/u,
    );
    expect(css).toMatch(
      /\.action-log__item \{[\s\S]*?justify-content: flex-start;/u,
    );
    expect(css).toMatch(
      /\.action-log__item \{[^}]*color: rgb\(174 184 176 \/ 66%\);/u,
    );
    expect(css).toMatch(/\.action-log__item\[data-state="requested"\] \{/u);
    expect(css).not.toMatch(/\.action-log__item \{[^}]*opacity:/u);
    expect(css).toMatch(/\.action-log:focus-visible \{/u);
    expect(css).toMatch(
      /#voice-shell:has\(\.activity-indicator\[data-state="idle"\]\) #status/u,
    );
  });

  it("separates contextual playback actions from optional utilities", async () => {
    for (const path of [
      "apps/web/openai-live-smoke.html",
      "apps/web/voice-shell-smoke.html",
    ]) {
      const html = await readFile(new URL(path, repositoryRoot), "utf8");
      expect(html).toMatch(
        /class="session-actions" role="group" aria-label="Playback"[\s\S]*?id="stop"[\s\S]*?id="pause"[\s\S]*?id="repeat"/u,
      );
      expect(html).toMatch(
        /<\/main>\s*<footer class="app-footer">[\s\S]*?<nav class="utility-actions" aria-label="More options"/u,
      );
      expect(html).toMatch(
        /id="transcript-panel"[\s\S]*?aria-modal="true"[\s\S]*?id="close-transcript"/u,
      );
      expect(html).toMatch(
        /id="debug-panel"[\s\S]*?aria-modal="true"[\s\S]*?id="close-debug"[\s\S]*?id="debug-content"/u,
      );
    }
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(
      /\.session-actions button:disabled \{\s*display: none;/u,
    );
    expect(css).toMatch(/\.utility-actions \{[\s\S]*?border-radius: 999px;/u);
    expect(css).toMatch(/\.app-footer \{[\s\S]*?position: fixed;/u);
    expect(css).toMatch(/dialog\.utility-modal \{[\s\S]*?opacity: 0;/u);
  });

  it("keeps a visual narrator line and bounded muted history separate from the accessible transcript", async () => {
    for (const path of [
      "apps/web/openai-live-smoke.html",
      "apps/web/voice-shell-smoke.html",
    ]) {
      const html = await readFile(new URL(path, repositoryRoot), "utf8");
      expect(html).toMatch(
        /id="spoken-transcript"[^>]*aria-hidden="true"[^>]*hidden/u,
      );
      expect(html).toContain('id="spoken-line"');
      expect(html).toContain('id="spoken-history"');
    }
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(/\.spoken-word\.is-visible \{[\s\S]*?opacity: 1;/u);
    expect(css).toMatch(/\.spoken-history \{[\s\S]*?overflow: auto;/u);
    expect(css).toMatch(/\.spoken-history li \{[\s\S]*?color:/u);
    expect(css).toMatch(
      /#voice-shell:has\(\.spoken-transcript:not\(\[hidden\]\)\) \.activity-indicator \{\s*display: none;/u,
    );
    expect(css).toMatch(
      /#voice-shell:has\(\.spoken-transcript:not\(\[hidden\]\)\) \.status-feedback \{\s*min-height: 0;/u,
    );
    expect(css).toMatch(
      /\.spoken-transcript\[data-playback-state="settled"\] \{[\s\S]*?min-height: 0;[\s\S]*?align-content: start;/u,
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
    expect(css).toMatch(/#capture\[aria-pressed\]::before \{/u);
    expect(css).toMatch(
      /animation: waveform-listening 1\.6s ease-in-out infinite;/u,
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
