import { access, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const appRoot = resolve(repositoryRoot, ".ci/voice-shell");
const workerRoot = resolve(repositoryRoot, ".ci/dork-worker");
const htmlPath = resolve(repositoryRoot, "apps/web/voice-shell-smoke.html");
const cssPath = resolve(repositoryRoot, "apps/web/voice-shell.css");
const storyPath = resolve(
  repositoryRoot,
  "fixtures/stories/minimal/artifact/minimal.z3",
);
const requiredEntry = resolve(appRoot, "apps/web/src/voice-shell-smoke.js");
const port = Number(process.argv[2] ?? "4174");
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new RangeError("port must be an integer from 1024 through 65535");
}
await access(requiredEntry);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".z3", "application/octet-stream"],
]);
const csp =
  "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function beneath(root, pathname) {
  const candidate = resolve(root, pathname.replace(/^\/+/, ""));
  return candidate.startsWith(`${root}${sep}`) ? candidate : undefined;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let path;
    if (url.pathname === "/") path = htmlPath;
    else if (url.pathname === "/voice-shell.css") path = cssPath;
    else if (url.pathname === "/fixtures/stories/minimal/artifact/minimal.z3") {
      path = storyPath;
    } else if (url.pathname.startsWith("/app/")) {
      path = beneath(appRoot, url.pathname.slice("/app/".length));
    } else if (url.pathname.startsWith("/worker/")) {
      path = beneath(workerRoot, url.pathname.slice("/worker/".length));
    }
    if (path === undefined || !(await stat(path)).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    const body = await readFile(path);
    response.writeHead(200, {
      "Content-Type":
        contentTypes.get(extname(path)) ?? "application/octet-stream",
      "Content-Length": body.byteLength,
      "Cache-Control": "no-store",
      "Content-Security-Policy": csp,
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  } catch {
    response.writeHead(500).end("Internal server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Voice shell smoke: http://127.0.0.1:${port}/\n`);
});
