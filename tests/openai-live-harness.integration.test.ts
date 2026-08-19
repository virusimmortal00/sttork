import {
  createEphemeralLiveSessionToken,
  createOpenAiLocalLiveRequestListener,
  injectEphemeralLiveSessionToken,
  loadOpenAiApiKey,
} from "@zork-voice/server";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const syntheticApiKey = ["sk", "synthetic", "openai-live-harness-key"].join(
  "-",
);
const placeholder = "__ZORK_VOICE_SESSION_TOKEN__";
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zork-voice-live-harness-"));
  temporaryRoots.push(root);
  return root;
}

function incomingRequest(options: {
  readonly url: string;
  readonly method?: string;
  readonly headers?: IncomingHttpHeaders;
  readonly body?: string | Uint8Array;
}): IncomingMessage {
  const body =
    typeof options.body === "string"
      ? Buffer.from(options.body, "utf8")
      : options.body;
  const stream = Readable.from(body === undefined ? [] : [body]);
  return Object.assign(stream, {
    url: options.url,
    method: options.method ?? "GET",
    headers: options.headers ?? {},
  }) as unknown as IncomingMessage;
}

class CapturedResponse extends EventEmitter {
  public headersSent = false;
  public writableEnded = false;
  public status = 0;
  public readonly headers = new Map<string, string>();
  public body = new Uint8Array();
  readonly #completed: Promise<void>;
  #complete: (() => void) | undefined;

  public constructor() {
    super();
    this.#completed = new Promise((resolve) => {
      this.#complete = resolve;
    });
  }

  public writeHead(
    status: number,
    headers: Readonly<Record<string, string | number>>,
  ): this {
    this.status = status;
    this.headersSent = true;
    for (const [name, value] of Object.entries(headers)) {
      this.headers.set(name.toLocaleLowerCase("en-US"), String(value));
    }
    return this;
  }

  public end(body?: string | Uint8Array): this {
    this.body =
      body === undefined
        ? new Uint8Array()
        : typeof body === "string"
          ? Buffer.from(body, "utf8")
          : Uint8Array.from(body);
    this.writableEnded = true;
    this.#complete?.();
    this.#complete = undefined;
    return this;
  }

  public async completed(): Promise<void> {
    await this.#completed;
  }
}

async function invoke(
  listener: RequestListener,
  request: IncomingMessage,
): Promise<CapturedResponse> {
  const response = new CapturedResponse();
  listener(request, response as unknown as ServerResponse);
  await response.completed();
  return response;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("OpenAI local live harness", () => {
  it("uses a process key without reading a local secret file", async () => {
    const ignoredCheck = vi.fn(() => {
      throw new Error("local file should not be inspected");
    });

    await expect(
      loadOpenAiApiKey({
        repositoryRoot: "/path/that/does/not/exist",
        environment: { OPENAI_API_KEY: syntheticApiKey },
        isIgnored: ignoredCheck,
      }),
    ).resolves.toBe(syntheticApiKey);
    expect(ignoredCheck).not.toHaveBeenCalled();
  });

  it("loads only an ignored, regular mode-0600 local key file", async () => {
    const root = await temporaryRoot();
    const target = join(root, ".env.local");
    await writeFile(target, `OPENAI_API_KEY=${syntheticApiKey}\n`, {
      mode: 0o600,
    });
    await chmod(target, 0o600);

    await expect(
      loadOpenAiApiKey({
        repositoryRoot: root,
        environment: {},
        isIgnored: () => true,
      }),
    ).resolves.toBe(syntheticApiKey);

    await chmod(target, 0o644);
    await expect(
      loadOpenAiApiKey({
        repositoryRoot: root,
        environment: {},
        isIgnored: () => true,
      }),
    ).rejects.toThrow("mode-0600");

    await chmod(target, 0o600);
    await expect(
      loadOpenAiApiKey({
        repositoryRoot: root,
        environment: {},
        isIgnored: () => false,
      }),
    ).rejects.toThrow("ignored by Git");
  });

  it("creates unguessable HTML-safe tokens and injects exactly one placeholder", () => {
    const first = createEphemeralLiveSessionToken();
    const second = createEphemeralLiveSessionToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
    expect(
      injectEphemeralLiveSessionToken(
        `<meta name="zork-voice-live-session" content="${placeholder}">`,
        first,
      ),
    ).toContain(`content="${first}"`);
    expect(() =>
      injectEphemeralLiveSessionToken("<html></html>", first),
    ).toThrow("exactly one");
    expect(() =>
      injectEphemeralLiveSessionToken(`${placeholder}${placeholder}`, first),
    ).toThrow("exactly one");
  });

  it("serves only the bounded same-origin live surface with hardened headers", async () => {
    const root = await temporaryRoot();
    const appRoot = join(root, "app");
    const workerRoot = join(root, "worker");
    await Promise.all([
      mkdir(join(appRoot, "apps/web/src"), { recursive: true }),
      mkdir(join(workerRoot, "spikes/dork-worker"), { recursive: true }),
    ]);
    const paths = {
      htmlPath: join(root, "openai-live-smoke.html"),
      cssPath: join(root, "voice-shell.css"),
      storyPath: join(root, "zork1.z3"),
      appRoot,
      workerRoot,
    };
    await Promise.all([
      writeFile(
        paths.htmlPath,
        `<meta name="zork-voice-live-session" content="${placeholder}">`,
      ),
      writeFile(paths.cssPath, "main { display: block; }"),
      writeFile(paths.storyPath, new Uint8Array([3, 1, 4])),
      writeFile(
        join(appRoot, "apps/web/src/openai-live-shell.js"),
        "export {};",
      ),
      writeFile(
        join(workerRoot, "spikes/dork-worker/browser-worker-entry.js"),
        "export {};",
      ),
    ]);

    const token = createEphemeralLiveSessionToken();
    const api = vi.fn(async (request: Request) => {
      const body = await request.text();
      return Response.json({ method: request.method, body });
    });
    const origin = "http://127.0.0.1:4319";
    const listener = createOpenAiLocalLiveRequestListener({
      allowedOrigin: origin,
      sessionToken: token,
      paths,
      handleApi: api,
    });

    const page = await invoke(listener, incomingRequest({ url: "/" }));
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(page.headers.get("content-security-policy")).toContain(
      "media-src 'self' blob:",
    );
    expect(page.headers.get("permissions-policy")).toBe("microphone=(self)");
    expect(new TextDecoder().decode(page.body)).toBe(
      `<meta name="zork-voice-live-session" content="${token}">`,
    );

    const story = await invoke(
      listener,
      incomingRequest({ url: "/vendor/zork1/zork1.z3" }),
    );
    expect([...story.body]).toEqual([3, 1, 4]);
    expect(story.headers.get("content-type")).toBe("application/octet-stream");

    const apiResponse = await invoke(
      listener,
      incomingRequest({
        url: "/api/live/openai/guide",
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-zork-voice-live-session": token,
        },
        body: "{}",
      }),
    );
    expect(apiResponse.status).toBe(200);
    expect(JSON.parse(new TextDecoder().decode(apiResponse.body))).toEqual({
      method: "POST",
      body: "{}",
    });
    expect(api).toHaveBeenCalledTimes(1);

    const oversized = await invoke(
      listener,
      incomingRequest({
        url: "/api/live/openai/guide",
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-zork-voice-live-session": token,
        },
        body: "x".repeat(16 * 1024 + 1),
      }),
    );
    expect(oversized.status).toBe(413);
    expect(JSON.parse(new TextDecoder().decode(oversized.body))).toEqual({
      error: { code: "request-too-large" },
    });
    expect(api).toHaveBeenCalledTimes(1);

    expect(
      (await invoke(listener, incomingRequest({ url: "/package.json" })))
        .status,
    ).toBe(404);
  });
});
