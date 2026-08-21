import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from "node:http";
import { extname, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const liveSessionPlaceholder = "__STTORK_SESSION_TOKEN__";
const localEnvironmentFile = ".env.local";
const maximumEnvironmentFileBytes = 64 * 1024;
const jsonRequestLimit = 16 * 1024;
const audioRequestLimit = 2 * 1024 * 1024;

export const OPENAI_LIVE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; script-src-attr 'none'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'none'; font-src 'none'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export interface OpenAiApiKeyLoaderOptions {
  readonly repositoryRoot: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly isIgnored?: (
    repositoryRoot: string,
    relativePath: string,
  ) => boolean;
}

export interface OpenAiLocalLivePaths {
  readonly htmlPath: string;
  readonly cssPath: string;
  readonly storyPath: string;
  readonly appRoot: string;
  readonly workerRoot: string;
}

export interface OpenAiLocalLiveHarnessOptions {
  readonly allowedOrigin: string;
  readonly sessionToken: string;
  readonly paths: OpenAiLocalLivePaths;
  readonly handleApi: (request: Request) => Promise<Response>;
}

function isUsableOpenAiApiKey(value: unknown): value is string {
  return typeof value === "string" && /^sk-[A-Za-z0-9_-]{20,}$/u.test(value);
}

function defaultIgnoredCheck(
  repositoryRoot: string,
  relativePath: string,
): boolean {
  const result = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--", relativePath],
    {
      cwd: repositoryRoot,
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_OPTIONAL_LOCKS: "0",
      },
      stdio: "ignore",
    },
  );
  return result.error === undefined && result.status === 0;
}

function keyFromEnvironmentFile(contents: string): string | undefined {
  let found: string | undefined;
  for (const line of contents.split(/\r?\n/u)) {
    if (/^\s*(?:#.*)?$/u.test(line)) continue;
    const match = /^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*?)\s*$/u.exec(
      line,
    );
    if (match === null) continue;
    if (found !== undefined) {
      throw new TypeError("The local OpenAI API key entry is duplicated.");
    }
    let candidate = match[1] ?? "";
    if (
      candidate.length >= 2 &&
      ((candidate.startsWith('"') && candidate.endsWith('"')) ||
        (candidate.startsWith("'") && candidate.endsWith("'")))
    ) {
      candidate = candidate.slice(1, -1);
    }
    found = candidate;
  }
  return found;
}

export async function loadOpenAiApiKey(
  options: OpenAiApiKeyLoaderOptions,
): Promise<string> {
  const environment = options.environment ?? process.env;
  const configured = environment.OPENAI_API_KEY;
  if (configured !== undefined) {
    if (!isUsableOpenAiApiKey(configured)) {
      throw new TypeError("OPENAI_API_KEY is not usable.");
    }
    return configured;
  }

  const repositoryRoot = resolve(options.repositoryRoot);
  const target = resolve(repositoryRoot, localEnvironmentFile);
  const isIgnored = options.isIgnored ?? defaultIgnoredCheck;
  if (!isIgnored(repositoryRoot, localEnvironmentFile)) {
    throw new TypeError(".env.local must be ignored by Git.");
  }
  const handle = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => undefined);
  if (handle === undefined) {
    throw new TypeError(
      ".env.local must be a regular, nonempty mode-0600 file.",
    );
  }
  let contents: string;
  try {
    const information = await handle.stat();
    if (
      !information.isFile() ||
      (information.mode & 0o777) !== 0o600 ||
      information.size <= 0 ||
      information.size > maximumEnvironmentFileBytes ||
      (process.getuid !== undefined && information.uid !== process.getuid())
    ) {
      throw new TypeError(
        ".env.local must be a regular, current-user-owned, nonempty mode-0600 file.",
      );
    }
    contents = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
  const key = keyFromEnvironmentFile(contents);
  if (!isUsableOpenAiApiKey(key)) {
    throw new TypeError(".env.local does not contain a usable API key.");
  }
  return key;
}

export function createEphemeralLiveSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function isLiveSessionToken(value: string): boolean {
  return value.length === 43 && /^[A-Za-z0-9_-]+$/u.test(value);
}

export function injectEphemeralLiveSessionToken(
  html: string,
  sessionToken: string,
): string {
  if (!isLiveSessionToken(sessionToken)) {
    throw new TypeError("The live session token is invalid.");
  }
  const pieces = html.split(liveSessionPlaceholder);
  if (pieces.length !== 2) {
    throw new TypeError(
      "The live HTML must contain exactly one session-token placeholder.",
    );
  }
  return `${pieces[0]}${sessionToken}${pieces[1]}`;
}

export function parseOpenAiLiveOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new TypeError(
      "The live harness origin must be an exact loopback HTTP or HTTPS origin.",
    );
  }
  const isLoopbackHttp =
    origin.protocol === "http:" &&
    /^(?:127\.0\.0\.1|localhost)$/u.test(origin.hostname);
  const isHttps = origin.protocol === "https:";
  if (
    origin.origin !== value ||
    origin.hostname.includes("*") ||
    (!isLoopbackHttp && !isHttps)
  ) {
    throw new TypeError(
      "The live harness origin must be an exact loopback HTTP or HTTPS origin.",
    );
  }
  return origin;
}

function commonHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": OPENAI_LIVE_CONTENT_SECURITY_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "microphone=(self)",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function declaredContentLength(
  headers: IncomingHttpHeaders,
): number | undefined {
  const value = headers["content-length"];
  if (value === undefined) return undefined;
  if (Array.isArray(value) || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError("Invalid content length.");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new TypeError("Invalid content length.");
  }
  return length;
}

async function readBoundedRequestBody(
  request: IncomingMessage,
  maximum: number,
): Promise<Uint8Array> {
  const declared = declaredContentLength(request.headers);
  if (declared !== undefined && declared > maximum) {
    request.resume();
    throw new RangeError("Request body is too large.");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : new Uint8Array(chunk as Uint8Array);
    total += bytes.byteLength;
    if (total > maximum) {
      request.resume();
      throw new RangeError("Request body is too large.");
    }
    chunks.push(bytes);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function webHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else {
      result.set(name, value);
    }
  }
  return result;
}

async function writeWebResponse(
  source: Response,
  target: ServerResponse,
  headOnly = false,
): Promise<void> {
  const body = new Uint8Array(await source.arrayBuffer());
  const headers = new Headers(source.headers);
  for (const [name, value] of Object.entries(commonHeaders())) {
    headers.set(name, value);
  }
  headers.set("Content-Length", String(body.byteLength));
  target.writeHead(source.status, Object.fromEntries(headers.entries()));
  target.end(headOnly ? undefined : body);
}

function writeFailure(
  response: ServerResponse,
  status: number,
  code: string,
): void {
  const body = Buffer.from(JSON.stringify({ error: { code } }), "utf8");
  response.writeHead(status, {
    ...commonHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.byteLength,
  });
  response.end(body);
}

async function pathWithin(
  root: string,
  relativePath: string,
): Promise<string | undefined> {
  const candidate = resolve(root, relativePath.replace(/^\/+/, ""));
  if (!candidate.startsWith(`${resolve(root)}${sep}`)) return undefined;
  try {
    const candidateInformation = await lstat(candidate);
    if (
      !candidateInformation.isFile() ||
      candidateInformation.isSymbolicLink()
    ) {
      return undefined;
    }
    const [resolvedRoot, resolvedCandidate] = await Promise.all([
      realpath(root),
      realpath(candidate),
    ]);
    return resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
      ? resolvedCandidate
      : undefined;
  } catch {
    return undefined;
  }
}

async function fixedFile(path: string): Promise<string | undefined> {
  try {
    const information = await lstat(path);
    return information.isFile() && !information.isSymbolicLink()
      ? path
      : undefined;
  } catch {
    return undefined;
  }
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".z3", "application/octet-stream"],
]);

async function staticPath(
  pathname: string,
  paths: OpenAiLocalLivePaths,
): Promise<string | undefined> {
  if (pathname === "/" || pathname === "/openai-live-smoke.html") {
    return fixedFile(paths.htmlPath);
  }
  if (pathname === "/voice-shell.css") return fixedFile(paths.cssPath);
  if (pathname === "/vendor/zork1/zork1.z3") {
    return fixedFile(paths.storyPath);
  }
  if (pathname.startsWith("/app/")) {
    return pathWithin(paths.appRoot, pathname.slice("/app/".length));
  }
  if (pathname.startsWith("/worker/")) {
    return pathWithin(paths.workerRoot, pathname.slice("/worker/".length));
  }
  return undefined;
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  options: OpenAiLocalLiveHarnessOptions,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    writeFailure(response, 405, "method-not-allowed");
    return;
  }
  const path = await staticPath(pathname, options.paths);
  if (path === undefined || !(await stat(path)).isFile()) {
    writeFailure(response, 404, "not-found");
    return;
  }
  let body = await readFile(path);
  if (path === options.paths.htmlPath) {
    body = Buffer.from(
      injectEphemeralLiveSessionToken(
        body.toString("utf8"),
        options.sessionToken,
      ),
      "utf8",
    );
  }
  response.writeHead(200, {
    ...commonHeaders(),
    "Content-Type":
      contentTypes.get(extname(path)) ?? "application/octet-stream",
    "Content-Length": body.byteLength,
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

async function serveApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  origin: URL,
  handleApi: OpenAiLocalLiveHarnessOptions["handleApi"],
): Promise<void> {
  const abort = new AbortController();
  const abortRequest = () => abort.abort();
  const abortResponse = () => {
    if (!response.writableEnded) abort.abort();
  };
  request.once("aborted", abortRequest);
  response.once("close", abortResponse);
  try {
    const method = request.method ?? "GET";
    const requestInit: RequestInit = {
      method,
      headers: webHeaders(request.headers),
      signal: abort.signal,
    };
    if (method !== "GET" && method !== "HEAD") {
      const maximum =
        pathname === "/api/live/openai/transcribe"
          ? audioRequestLimit + jsonRequestLimit
          : jsonRequestLimit;
      const body = await readBoundedRequestBody(request, maximum);
      requestInit.body = Uint8Array.from(body).buffer;
    }
    const webRequest = new Request(
      new URL(request.url ?? pathname, origin).href,
      requestInit,
    );
    await writeWebResponse(
      await handleApi(webRequest),
      response,
      method === "HEAD",
    );
  } catch (error) {
    if (error instanceof RangeError) {
      writeFailure(response, 413, "request-too-large");
    } else if (error instanceof TypeError) {
      writeFailure(response, 400, "invalid-request");
    } else {
      writeFailure(response, 500, "internal-error");
    }
  } finally {
    request.off("aborted", abortRequest);
    response.off("close", abortResponse);
  }
}

export function createOpenAiLocalLiveRequestListener(
  options: OpenAiLocalLiveHarnessOptions,
): RequestListener {
  const origin = parseOpenAiLiveOrigin(options.allowedOrigin);
  if (!isLiveSessionToken(options.sessionToken)) {
    throw new TypeError("The live session token is invalid.");
  }
  return (request, response) => {
    if (request.headers.host !== origin.host) {
      writeFailure(response, 403, "forbidden");
      return;
    }
    void (async () => {
      const pathname = new URL(request.url ?? "/", origin).pathname;
      if (pathname.startsWith("/api/live/openai/")) {
        await serveApi(request, response, pathname, origin, options.handleApi);
      } else {
        await serveStatic(request, response, pathname, options);
      }
    })().catch(() => {
      if (!response.headersSent) writeFailure(response, 500, "internal-error");
      else response.end();
    });
  };
}
