import {createReadStream, existsSync} from "node:fs";
import {realpath, stat} from "node:fs/promises";
import {createServer as createHttpServer} from "node:http";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {fileURLToPath} from "node:url";
import {ApiInputError, GpkgFeatureStore} from "./gpkg-features.js";

const PACKAGE_ROOT = (() => {
  const isBunCompiled = process.argv[1]?.includes("~BUN") || process.argv[1]?.includes("$bunfs");
  if (isBunCompiled) return path.dirname(path.resolve(process.execPath));
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
})();
const APP_ASSETS = path.join(PACKAGE_ROOT, "assets");
const MAPLIBRE_ASSETS = path.join(PACKAGE_ROOT, "maplibre");
const resolveVendor = (pkg, file) => {
  const fromVendor = path.join(PACKAGE_ROOT, "vendor", file);
  return existsSync(fromVendor) ? fromVendor : path.join(PACKAGE_ROOT, "node_modules", pkg, "dist", file);
};
const VENDOR_FILES = new Map([
  ["/preview/vendor/maplibre-gl.js", resolveVendor("maplibre-gl", "maplibre-gl.js")],
  ["/preview/vendor/maplibre-gl.css", resolveVendor("maplibre-gl", "maplibre-gl.css")],
  ["/preview/vendor/pmtiles.js", resolveVendor("pmtiles", "pmtiles.js")],
]);
const SPRITE_FILES = new Set([
  "/sprite.json",
  "/sprite.png",
  "/sprite@2x.json",
  "/sprite@2x.png",
]);

export const startServer = async (output, options = {}) => {
  const root = await realpath(output);
  const featureStore = options.manifest ? await GpkgFeatureStore.create(root, options.manifest).catch((error) => error) : undefined;
  const server = createHttpServer((request, response) => {
    respond(request, response, root, {...options, featureStore}).catch((error) => {
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

export const parseRange = (header, length) => {
  if (!header) return {start: 0, end: length - 1, status: 200};
  if (length === 0 || !header.startsWith("bytes=") || header.includes(",")) {
    throw new RangeError("invalid range");
  }
  const parts = header.slice(6).split("-");
  if (parts.length !== 2) throw new RangeError("invalid range");
  const [startValue, endValue] = parts;
  const start = startValue ? parseInteger(startValue) : Math.max(0, length - parseInteger(endValue));
  const end = startValue && endValue ? Math.min(parseInteger(endValue), length - 1) : length - 1;
  if (start < 0 || start > end || start >= length) throw new RangeError("range not satisfiable");
  return {start, end, status: 206};
};

const respond = async (request, response, root, options) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, {Allow: "GET, HEAD"});
    response.end();
    return;
  }
  const pathname = requestPath(request.url);
  if (pathname === "/preview/api/features") {
    respondFeatures(request, response, options.featureStore);
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

const requestPath = (url) => {
  try {
    return decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return "";
  }
};

const respondFeatures = (request, response, featureStore) => {
  if (featureStore instanceof Error) {
    sendJson(request, response, featureStore.status ?? 500, {error: featureStore.message});
    return;
  }
  if (!featureStore) {
    sendJson(request, response, 404, {error: "feature API is not available"});
    return;
  }
  try {
    const url = new URL(request.url, "http://localhost");
    sendJson(request, response, 200, featureStore.search(url.searchParams));
  } catch (error) {
    if (error instanceof ApiInputError) {
      sendJson(request, response, error.status, {error: error.message});
      return;
    }
    throw error;
  }
};

const sendJson = (request, response, status, value) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  response.end(body);
};

const resolveFile = async (pathname, root, options) => {
  const appAssets = options.appAssets ?? APP_ASSETS;
  const vendorFiles = options.vendorFiles ?? VENDOR_FILES;
  const maplibreAssets = options.maplibreAssets ?? MAPLIBRE_ASSETS;
  if (pathname === "/" || pathname === "/preview" || pathname === "/preview/") {
    return path.join(appAssets, "index.html");
  }
  if (pathname === "/preview/assets/app.js" || pathname === "/preview/assets/app.css") {
    return path.join(appAssets, path.basename(pathname));
  }
  if (vendorFiles.has(pathname)) return vendorFiles.get(pathname);
  if (pathname.startsWith("/maplibre/")) {
    return secureFile(maplibreAssets, pathname.slice("/maplibre".length));
  }
  if (SPRITE_FILES.has(pathname)) {
    return secureFile(path.join(maplibreAssets, "sprite"), pathname);
  }
  if (pathname.startsWith("/glyphs/")) {
    return secureFile(path.join(maplibreAssets, "glyphs"), pathname.slice("/glyphs".length));
  }
  return secureFile(root, pathname);
};

const secureFile = async (root, pathname) => {
  if (!pathname.startsWith("/") || pathname.includes("\\")) return undefined;
  const relative = pathname.slice(1);
  if (!relative || relative.split("/").some((part) => !part || part === "." || part === "..")) {
    return undefined;
  }
  const candidate = path.join(root, ...relative.split("/"));
  try {
    const [metadata, canonical] = await Promise.all([stat(candidate), realpath(candidate)]);
    return metadata.isFile() && isWithin(root, canonical) ? canonical : undefined;
  } catch {
    return undefined;
  }
};

const sendFile = async (request, response, file) => {
  const metadata = await stat(file);
  let range;
  try {
    range = parseRange(request.headers.range, metadata.size);
  } catch {
    response.writeHead(416, {"Content-Range": `bytes */${metadata.size}`});
    response.end();
    return;
  }
  const length = metadata.size === 0 ? 0 : range.end - range.start + 1;
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Length": length,
    "Content-Type": mimeType(file),
  };
  if (range.status === 206) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${metadata.size}`;
  response.writeHead(range.status, headers);
  if (request.method === "HEAD" || metadata.size === 0) {
    response.end();
    return;
  }
  await pipeline(createReadStream(file, {start: range.start, end: range.end}), response);
};

const listen = (server, port) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});

const parseInteger = (value) => {
  if (!/^\d+$/.test(value)) throw new RangeError("invalid range");
  const integer = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(integer)) throw new RangeError("invalid range");
  return integer;
};

const isWithin = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

const mimeType = (file) => ({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pbf": "application/x-protobuf",
  ".pmtiles": "application/vnd.pmtiles",
  ".png": "image/png",
}[path.extname(file)] ?? "application/octet-stream");
