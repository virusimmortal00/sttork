import { access, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const compiledRoot = resolve(repositoryRoot, ".ci/dork-worker");
const smokeHtml = resolve(
  repositoryRoot,
  "spikes/dork-worker/browser-smoke.html",
);
const storyPath = resolve(
  repositoryRoot,
  "fixtures/stories/minimal/artifact/minimal.z3",
);
const requiredEntry = resolve(
  compiledRoot,
  "spikes/dork-worker/browser-worker-entry.js",
);
const portArgument = process.argv[2] ?? "4173";
const port = Number(portArgument);

if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new RangeError("port must be an integer from 1024 through 65535");
}
await access(requiredEntry);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".z3", "application/octet-stream"],
]);
const csp =
  "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function compiledPath(pathname) {
  const relative = pathname.replace(/^\/+/, "");
  const candidate = resolve(compiledRoot, relative);
  if (!candidate.startsWith(`${compiledRoot}${sep}`)) return undefined;
  return candidate;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let path;
    if (url.pathname === "/" || url.pathname === "/browser-smoke.html") {
      path = smokeHtml;
    } else if (
      url.pathname === "/fixtures/stories/minimal/artifact/minimal.z3"
    ) {
      path = storyPath;
    } else {
      path = compiledPath(url.pathname);
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
  process.stdout.write(`Dork Worker smoke: http://127.0.0.1:${port}/\n`);
});
