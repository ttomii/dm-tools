import {createReadStream} from "node:fs";
import {realpath, stat} from "node:fs/promises";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {createDefaultAssetRoots} from "./asset-roots.js";

const ROOT_SPRITE_FILES = new Set([
  "/sprite.json",
  "/sprite.png",
  "/sprite@2x.json",
  "/sprite@2x.png",
]);

export const resolveFile = async (pathname, root, options) => {
  const normalized = normalizePreviewPath(pathname);
  const defaults = createDefaultAssetRoots();
  const appAssets = options.appAssets ?? defaults.appAssets;
  const indexHtml = options.indexHtml ?? path.join(appAssets, "index.html");
  const vendorFiles = options.vendorFiles ?? defaults.vendorFiles;
  const maplibreAssets = options.maplibreAssets ?? defaults.maplibreAssets;
  if (pathname === "/" || pathname === "/preview" || pathname === "/preview/") {
    return indexHtml;
  }
  if (normalized.startsWith("/assets/")) {
    return secureFile(appAssets, normalized.slice("/assets".length));
  }
  if (vendorFiles.has(normalized)) return vendorFiles.get(normalized);
  if (normalized.startsWith("/maplibre/")) {
    const relativePath = normalized.slice("/maplibre".length);
    return await secureFile(maplibreAssets, relativePath)
      ?? secureFile(defaults.maplibreAssets, relativePath);
  }
  if (ROOT_SPRITE_FILES.has(normalized)) {
    return secureFile(path.join(maplibreAssets, "sprite"), normalized);
  }
  if (normalized.startsWith("/glyphs/")) {
    return secureFile(path.join(maplibreAssets, "glyphs"), normalized.slice("/glyphs".length));
  }
  return secureFile(root, normalized);
};

export const sendFile = async (request, response, file) => {
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

export const normalizePreviewPath = (pathname) => pathname.startsWith("/preview/")
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
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pbf": "application/x-protobuf",
  ".pmtiles": "application/vnd.pmtiles",
  ".png": "image/png",
}[path.extname(file)] ?? "application/octet-stream");
