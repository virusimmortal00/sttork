import {
  installDorkBrowserWorkerEndpoint,
  type DorkBrowserWorkerScope,
} from "./browser-worker-endpoint.js";

installDorkBrowserWorkerEndpoint(
  globalThis as unknown as DorkBrowserWorkerScope,
);
