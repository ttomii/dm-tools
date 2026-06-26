import {createReadStream} from "node:fs";
import {cp, mkdir, readFile, realpath, stat, writeFile} from "node:fs/promises";
import {createServer as createHttpServer} from "node:http";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {createDefaultAssetRoots, createOutputAssetRoots} from "./asset-roots.js";
import {ApiInputError, GpkgFeatureStore} from "./gpkg-features.js";

const SPRITE_FILES = new Set([
  "/sprite.json",
  "/sprite.png",
  "/sprite@2x.json",
  "/sprite@2x.png",
]);
const STYLE_EDITOR_PATH = "/preview/api/style-editor/state";
const STYLE_EDITOR_BODY_LIMIT = 20 * 1024 * 1024;
const STYLE_EDITOR_SPRITE_FILES = new Set([
  "sprite.json",
  "sprite.png",
  "sprite@2x.json",
  "sprite@2x.png",
]);

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
  if (normalizePreviewPath(pathname) === "/pmtiles-manifest.json" && options.manifest) {
    sendJson(request, response, 200, options.manifest);
    return;
  }
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

const respondStyleEditor = async (request, response, root, options) => {
  if (request.method === "GET" || request.method === "HEAD") {
    await respondStyleEditorState(request, response, root);
    return;
  }
  if (request.method === "PUT") {
    await updateStyleEditorState(request, response, root, options);
    return;
  }
  response.writeHead(405, {Allow: "GET, HEAD, PUT"});
  response.end();
};

const respondStyleEditorState = async (request, response, root) => {
  const stylePath = path.join(root, "style.json");
  let style;
  try {
    style = JSON.parse(await readFile(stylePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(request, response, 200, {writable: true, style: null, editableKinds: [], editableLayers: []});
      return;
    }
    sendJson(request, response, 500, {error: `style.json cannot be read: ${error.message}`});
    return;
  }
  sendJson(request, response, 200, {
    writable: true,
    style,
    editableKinds: editableKinds(style),
    editableLayers: editableLayers(style),
  });
};

const updateStyleEditorState = async (request, response, root, options) => {
  const stylePath = path.join(root, "style.json");
  try {
    const metadata = await stat(stylePath);
    if (!metadata.isFile()) {
      sendJson(request, response, 409, {error: "style.json is not writable"});
      return;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      sendJson(request, response, 500, {error: `style.json cannot be checked: ${error.message}`});
      return;
    }
  }
  let body;
  try {
    body = JSON.parse(await readBody(request, STYLE_EDITOR_BODY_LIMIT));
  } catch (error) {
    sendJson(request, response, 400, {error: error.message});
    return;
  }
  if (!isStyle(body.style)) {
    sendJson(request, response, 400, {error: "style must be a MapLibre Style v8 object"});
    return;
  }
  if (body.sprites !== undefined && !isRecord(body.sprites)) {
    sendJson(request, response, 400, {error: "sprites must be an object"});
    return;
  }
  try {
    await writeFile(stylePath, `${JSON.stringify(body.style, undefined, 2)}\n`);
    if (body.sprites) {
      await writeSpriteFiles(root, body.sprites);
    } else {
      await copyStyleAssetDirectory(root, options.maplibreAssets, "sprite");
    }
    await copyStyleAssetDirectory(root, options.maplibreAssets, "glyphs");
  } catch (error) {
    sendJson(request, response, 500, {error: `style editor save failed: ${error.message}`});
    return;
  }
  sendJson(request, response, 200, {ok: true});
};

const copyStyleAssetDirectory = async (root, maplibreAssets, name) => {
  if (!maplibreAssets) return;
  const source = path.join(maplibreAssets, name);
  const destination = path.join(root, name);
  if (await exists(destination)) return;
  const sourceReal = await realpath(source).catch(() => undefined);
  if (!sourceReal) return;
  if (sourceReal === root || sourceReal.startsWith(`${root}${path.sep}`)) return;
  await cp(sourceReal, destination, {recursive: true});
};

const exists = async (file) => stat(file).then(() => true, () => false);

const editableKinds = (style) => [...new Set(editableLayers(style).flatMap((layer) => layer.colorKind ? [layer.colorKind] : []))];

const editableLayers = (style) => (Array.isArray(style.layers) ? style.layers : [])
  .filter((layer) => isRecord(layer) && layer.source === "dm" && typeof layer.id === "string")
  .map((layer) => {
    const colorProperties = editableColorProperties(layer);
    return {
      id: layer.id,
      sourceLayer: layer["source-layer"],
      type: layer.type,
      colorKind: colorKind(layer),
      colorProperties,
      visibility: layer.layout?.visibility === "none" ? "none" : "visible",
      editableColor: colorProperties.length > 0,
      editableVisibility: true,
    };
  })
  .filter((layer) => layer.editableColor || layer.editableVisibility);

const editableColorProperties = (layer) => {
  if (layer.type === "symbol" && layer.layout?.["icon-image"]) return ["icon-image"];
  if (layer.type === "symbol" && layer.layout?.["text-field"] && layer.paint?.["text-color"] !== undefined) return ["text-color"];
  if (layer.type === "line" && layer.paint?.["line-color"] !== undefined) return ["line-color"];
  if (layer.type === "circle") {
    if (layer.paint?.["circle-stroke-color"] !== undefined) return ["circle-stroke-color"];
    if (layer.paint?.["circle-color"] !== undefined) return ["circle-color"];
  }
  if (layer.type === "fill") {
    return ["fill-color", "fill-outline-color"].filter((property) => layer.paint?.[property] !== undefined);
  }
  return [];
};

const colorKind = (layer) => {
  const sourceKind = sourceLayerKind(layer["source-layer"]);
  if (layer.type === "symbol" && layer.layout?.["icon-image"]) return "icon";
  if (layer.type === "symbol" && layer.layout?.["text-field"]) return "text";
  if (layer.type === "circle") return "icon";
  if (layer.type === "line") return sourceKind === "polygon" ? "polygon" : "line";
  if (layer.type === "fill") return "polygon";
  return undefined;
};

const sourceLayerKind = (sourceLayer) => {
  const match = /^dm_(?:default|\d+)_(point|line|polygon|text)(?:_deco_(point|line|polygon))?$/.exec(sourceLayer ?? "");
  return match?.[2] ?? match?.[1];
};

const readBody = (request, limit) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > limit) {
      reject(new Error("request body is too large"));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  request.on("error", reject);
});

const writeSpriteFiles = async (root, sprites) => {
  const spriteRoot = path.join(root, "sprite");
  await mkdir(spriteRoot, {recursive: true});
  for (const [file, value] of Object.entries(sprites)) {
    if (!STYLE_EDITOR_SPRITE_FILES.has(file)) throw new Error(`unsupported sprite file: ${file}`);
    const output = path.join(spriteRoot, file);
    if (file.endsWith(".json")) {
      if (!isRecord(value)) throw new Error(`${file} must be an object`);
      await writeFile(output, `${JSON.stringify(value, undefined, 2)}\n`);
    } else {
      if (typeof value !== "string") throw new Error(`${file} must be a data URL`);
      await writeFile(output, decodePngDataUrl(value));
    }
  }
};

const decodePngDataUrl = (value) => {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new Error("sprite PNG must be a PNG data URL");
  return Buffer.from(match[1], "base64");
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
  const normalized = normalizePreviewPath(pathname);
  const defaults = createDefaultAssetRoots();
  const appAssets = options.appAssets ?? defaults.appAssets;
  const indexHtml = options.indexHtml ?? path.join(appAssets, "index.html");
  const vendorFiles = options.vendorFiles ?? defaults.vendorFiles;
  const maplibreAssets = options.maplibreAssets ?? defaults.maplibreAssets;
  if (pathname === "/" || pathname === "/preview" || pathname === "/preview/") {
    return indexHtml;
  }
  if (normalized === "/assets/app.js" || normalized === "/assets/app.css") {
    return path.join(appAssets, path.basename(normalized));
  }
  if (vendorFiles.has(normalized)) return vendorFiles.get(normalized);
  if (normalized.startsWith("/maplibre/")) {
    return secureFile(maplibreAssets, normalized.slice("/maplibre".length));
  }
  if (SPRITE_FILES.has(normalized)) {
    return secureFile(path.join(maplibreAssets, "sprite"), normalized);
  }
  if (normalized.startsWith("/glyphs/")) {
    return secureFile(path.join(maplibreAssets, "glyphs"), normalized.slice("/glyphs".length));
  }
  return secureFile(root, normalized);
};

const normalizePreviewPath = (pathname) => pathname.startsWith("/preview/")
  ? pathname.slice("/preview".length)
  : pathname;

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

const isRecord = (value) => typeof value === "object" && Boolean(value) && !Array.isArray(value);

const isStyle = (value) => isRecord(value) && value.version === 8 && isRecord(value.sources);

const mimeType = (file) => ({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pbf": "application/x-protobuf",
  ".pmtiles": "application/vnd.pmtiles",
  ".png": "image/png",
}[path.extname(file)] ?? "application/octet-stream");
