import { access } from "node:fs/promises";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.argv[2] ?? "4175");
if (
  !Number.isSafeInteger(port) ||
  (port !== 0 && (port < 1024 || port > 65535))
) {
  throw new RangeError("port must be 0 or an integer from 1024 through 65535");
}

const internalPackages = new Map([
  ["@zork-voice/command-knowledge", "packages/command-knowledge"],
  ["@zork-voice/contracts", "packages/contracts"],
  ["@zork-voice/guide-core", "packages/guide-core"],
  ["@zork-voice/providers", "packages/providers"],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = internalPackages.get(specifier);
    if (target !== undefined) {
      return {
        shortCircuit: true,
        url: pathToFileURL(
          resolve(repositoryRoot, "dist", target, "src/index.js"),
        ).href,
      };
    }
    return nextResolve(specifier, context);
  },
});

const harnessPath = resolve(
  repositoryRoot,
  "dist/apps/server/src/local-live-harness.js",
);
const servicePath = resolve(
  repositoryRoot,
  "dist/apps/server/src/openai-live-service.js",
);
const providerPath = resolve(
  repositoryRoot,
  "dist/packages/providers/src/openai-chained.js",
);
const paths = {
  htmlPath: resolve(repositoryRoot, "apps/web/openai-live-smoke.html"),
  cssPath: resolve(repositoryRoot, "apps/web/voice-shell.css"),
  storyPath: resolve(repositoryRoot, "vendor/zork1/zork1.z3"),
  appRoot: resolve(repositoryRoot, ".ci/openai-live-shell"),
  workerRoot: resolve(repositoryRoot, ".ci/dork-worker"),
};
const requiredEntry = resolve(
  paths.appRoot,
  "apps/web/src/openai-live-shell.js",
);

await Promise.all([
  access(harnessPath),
  access(servicePath),
  access(providerPath),
  access(requiredEntry),
  access(
    resolve(paths.workerRoot, "spikes/dork-worker/browser-worker-entry.js"),
  ),
  access(paths.htmlPath),
  access(paths.cssPath),
  access(paths.storyPath),
]);

const [harness, service, providers] = await Promise.all([
  import(pathToFileURL(harnessPath).href),
  import(pathToFileURL(servicePath).href),
  import(pathToFileURL(providerPath).href),
]);
const configuredPublicOrigin = process.env.ZORK_VOICE_PUBLIC_ORIGIN;
if (configuredPublicOrigin !== undefined) {
  harness.parseOpenAiLiveOrigin(configuredPublicOrigin);
}
const apiKey = await harness.loadOpenAiApiKey({ repositoryRoot });
const sessionToken = harness.createEphemeralLiveSessionToken();
let listener;
const server = createServer((request, response) => {
  if (listener === undefined) {
    response.writeHead(503).end();
    return;
  }
  listener(request, response);
});
server.once("error", () => {
  process.stderr.write("OpenAI live voice smoke could not bind to loopback.\n");
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("The live server did not receive a TCP address.");
  }
  const upstreamOrigin = `http://127.0.0.1:${address.port}`;
  const allowedOrigin = configuredPublicOrigin ?? upstreamOrigin;
  const provider = new providers.OpenAiChainedProvider({
    apiKey,
    safetyIdentifier: sessionToken,
  });
  const handleApi = service.createOpenAiLiveService({
    provider,
    allowedOrigin,
    sessionToken,
  });
  listener = harness.createOpenAiLocalLiveRequestListener({
    allowedOrigin,
    sessionToken,
    paths,
    handleApi,
  });
  process.stdout.write(`OpenAI live voice smoke browser: ${allowedOrigin}/\n`);
  process.stdout.write(
    `OpenAI live voice smoke upstream: ${upstreamOrigin}/\n`,
  );
});
