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
      /\.action-log::before \{[\s\S]*?content: "Recent game commands";/u,
    );
    expect(css).toMatch(
      /\.action-log__item \{[\s\S]*?justify-content: center;/u,
    );
    expect(css).toMatch(/\.action-log__item \{[^}]*color: #aeb8b0;/u);
    expect(css).toMatch(/\.action-log__item\[data-state="requested"\] \{/u);
    expect(css).not.toMatch(/\.action-log__item \{[^}]*opacity:/u);
    expect(css).toMatch(/\.action-log:focus-visible \{/u);
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
      /#voice-shell\[data-story-phase="ready"\] \.status-feedback::before \{/u,
    );
    expect(css).toMatch(
      /#voice-shell\[data-story-phase="ready"\] #status,[\s\S]*?transition: none;/u,
    );
    expect(css).toMatch(
      /\.status-stage \{[\s\S]*?transform: translateY\(0\.45rem\);/u,
    );
    expect(css).toMatch(
      /\.primary-action \{[\s\S]*?transform: translateY\(0\.3rem\);/u,
    );
    expect(css).toMatch(/animation: wayfinder-turn 32s linear infinite;/u);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important;/u,
    );
  });
});
