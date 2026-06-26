import {realpath} from "node:fs/promises";
import {createServer as createHttpServer} from "node:http";
import path from "node:path";
import {createOutputAssetRoots} from "./asset-roots.js";
import {GpkgFeatureStore} from "./gpkg-features.js";
import {FEATURES_PATH, respondFeatures} from "./node/features-api.js";
import {requestPath, sendJson} from "./node/http-response.js";
import {parseRange, resolveFile, sendFile} from "./node/static-files.js";
import {respondStyleEditor, STYLE_EDITOR_PATH} from "./node/style-editor-api.js";

export {parseRange};

export const startServer = async (output, options = {}) => {
  const root = await realpath(output);
  const assetRoots = options.assetRoots ?? createOutputAssetRoots(root);
  const featureStore = options.manifest ? await GpkgFeatureStore.create(root, options.manifest).catch((error) => error) : undefined;
  const effectiveOptions = {...assetRoots, ...options, featureStore};
  if (options.appAssets && !options.indexHtml) {
    effectiveOptions.indexHtml = path.join(options.appAssets, "index.html");
  }
  const server = createHttpServer((request, response) => {
    respond(request, response, root, effectiveOptions).catch((error) => {
      console.error(`preview server error: ${error.message}`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await listen(server, options.port ?? 0);
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/preview/`;
  return {server, url};
};

const respond = async (request, response, root, options) => {
  const pathname = requestPath(request.url);
  if (pathname === STYLE_EDITOR_PATH) {
    await respondStyleEditor(request, response, root, options);
    return;
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, {Allow: "GET, HEAD"});
    response.end();
    return;
  }
  if (pathname === FEATURES_PATH) {
    respondFeatures(request, response, options.featureStore);
    return;
  }
  if (pathname === "/preview/pmtiles-manifest.json" && options.manifest) {
    sendJson(request, response, 200, options.manifest);
    return;
  }
  const file = await resolveFile(pathname, root, options);
  if (!file) {
    response.writeHead(404);
    response.end();
    return;
  }
  await sendFile(request, response, file);
};

const listen = (server, port) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});
