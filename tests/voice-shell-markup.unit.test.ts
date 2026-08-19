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
      expect(html).toMatch(
        /<h1 id="status" aria-live="polite" aria-atomic="true">/u,
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
        /<button id="capture" type="button" disabled>START STORY<\/button>/u,
      );
      expect(html).not.toMatch(/id="capture"[^>]*aria-pressed=/u);
      expect(html).toContain("Use Start story to hear the opening.");
    }
  });

  it("keeps recent commands in a compact scrolling visual hierarchy", async () => {
    const css = await readFile(
      new URL("apps/web/voice-shell.css", repositoryRoot),
      "utf8",
    );
    expect(css).toMatch(/\.action-log \{[\s\S]*?max-height:/u);
    expect(css).toMatch(/\.action-log \{[\s\S]*?overflow-y: auto;/u);
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
});
