import {readFile, realpath, stat} from "node:fs/promises";
import path from "node:path";

export const MANIFEST_FILENAME = "pmtiles-manifest.json";

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

export const readManifest = async (output) => {
  const root = await requireDirectory(output);
  const manifestPath = path.join(root, MANIFEST_FILENAME);
  const value = await readJson(manifestPath);
  const manifest = parseManifest(value);
  await Promise.all(manifestPaths(manifest).map((relative) => requireFile(root, relative)));
  return {manifest, root};
};

export const parseManifest = (value) => {
  if (!isRecord(value) || value.version !== 1) {
    throw new InputError("unsupported or missing manifest version");
  }
  if (typeof value.layerName !== "string" || !value.layerName) {
    throw new InputError("manifest layerName must be a non-empty string");
  }
  const pmtiles = parseRelativePath(value.pmtiles, "pmtiles");
  const levels = parseLevels(value.levels);
  const sourceLayers = parseSourceLayers(value.sourceLayers);
  const bounds = parseBounds(value.bounds);
  const center = parseCenter(value.center);
  return {version: 1, layerName: value.layerName, pmtiles, levels, sourceLayers, bounds, center};
};

export const resolveOutputPath = (root, relative) => {
  const validated = parseRelativePath(relative, "path");
  return path.join(root, ...validated.split("/"));
};

const requireDirectory = async (output) => {
  let metadata;
  try {
    metadata = await stat(output);
  } catch (error) {
    throw new InputError(`output cannot be read: ${output}: ${error.message}`);
  }
  if (!metadata.isDirectory()) {
    throw new InputError(`output is not a directory: ${output}`);
  }
  return realpath(output);
};

const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new InputError(`manifest cannot be read: ${file}: ${error.message}`);
  }
};

const requireFile = async (root, relative) => {
  const file = resolveOutputPath(root, relative);
  let metadata;
  try {
    metadata = await stat(file);
  } catch {
    throw new InputError(`manifest file is missing: ${relative}`);
  }
  const canonical = await realpath(file);
  if (!isWithin(root, canonical) || !metadata.isFile()) {
    throw new InputError(`manifest path is not a file: ${relative}`);
  }
};

const parseLevels = (value) => {
  if (!Array.isArray(value) || !value.length) {
    throw new InputError("manifest levels must be a non-empty array");
  }
  if (!value.every((level) => Number.isInteger(level) && level > 0)) {
    throw new InputError("manifest levels must be positive integers");
  }
  return [...value];
};

const parseBounds = (value) => {
  const bounds = parseNumberArray(value, 4, "bounds");
  const [west, south, east, north] = bounds;
  if (west > east || south > north || west < -180 || east > 180 || south < -90 || north > 90) {
    throw new InputError("manifest bounds are invalid");
  }
  return bounds;
};

const parseSourceLayers = (value) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new InputError("manifest sourceLayers must be an array");
  }
  if (!value.every((layer) => typeof layer === "string" && /^dm_[0-9]+_(point|line|polygon|text)(?:_deco_(?:point|line|polygon))?$/.test(layer))) {
    throw new InputError("manifest sourceLayers contains an invalid source-layer name");
  }
  return [...value];
};

const parseCenter = (value) => {
  const center = parseNumberArray(value, 3, "center");
  const [longitude, latitude, zoom] = center;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90 || zoom < 0 || zoom > 24) {
    throw new InputError("manifest center is invalid");
  }
  return center;
};

const parseNumberArray = (value, length, name) => {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) {
    throw new InputError(`manifest ${name} must contain ${length} finite numbers`);
  }
  return [...value];
};

const parseRelativePath = (value, name) => {
  if (typeof value !== "string" || !value || value.includes("\\")) {
    throw new InputError(`manifest ${name} must be a relative path`);
  }
  const parts = value.split("/");
  if (path.isAbsolute(value) || parts.some((part) => !part || part === "." || part === "..")) {
    throw new InputError(`manifest ${name} must be a relative path`);
  }
  return value;
};

const manifestPaths = (manifest) => [manifest.pmtiles];

const isRecord = (value) => typeof value === "object" && Boolean(value) && !Array.isArray(value);

const isWithin = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
