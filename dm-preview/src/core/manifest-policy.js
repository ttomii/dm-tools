export const MANIFEST_FILENAME = "pmtiles-manifest.json";

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

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
  const styles = parseStyles(value.styles);
  const manifest = {version: 1, layerName: value.layerName, pmtiles, levels, sourceLayers, bounds, center};
  return styles ? {...manifest, styles} : manifest;
};

export const parseStyleManifest = (style) => {
  const dmSource = isRecord(style.sources.dm) ? style.sources.dm : undefined;
  if (!dmSource) throw new InputError("style.json must contain a dm source");
  const pmtiles = parsePmtilesUrl(dmSource.url);
  const metadata = isRecord(style.metadata) ? style.metadata : {};
  return {
    version: 1,
    layerName: typeof style.name === "string" && style.name ? style.name : "dm",
    pmtiles,
    levels: parseStyleLevels(metadata),
    sourceLayers: parseStyleSourceLayers(style, metadata),
    bounds: parseBounds(metadata["dm:bounds"]),
    center: parseCenter(metadata["dm:center"]),
    styles: ["style.json"],
  };
};

export const parseRelativePath = (value, name) => {
  if (typeof value !== "string" || !value || value.includes("\\")) {
    throw new InputError(`manifest ${name} must be a relative path`);
  }
  const parts = value.split("/");
  if (value.startsWith("/") || parts.some((part) => !part || part === "." || part === "..")) {
    throw new InputError(`manifest ${name} must be a relative path`);
  }
  return value;
};

export const manifestPaths = (manifest) => [manifest.pmtiles, ...(manifest.styles ?? [])];

export const isStyle = (value) => isRecord(value) && value.version === 8 && isRecord(value.sources);

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

const parseStyles = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length) {
    throw new InputError("manifest styles must be a non-empty array");
  }
  return value.map((style) => parseRelativePath(style, "styles"));
};

const parseNumberArray = (value, length, name) => {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) {
    throw new InputError(`manifest ${name} must contain ${length} finite numbers`);
  }
  return [...value];
};

const parsePmtilesUrl = (value) => {
  if (typeof value !== "string" || !value.startsWith("pmtiles://")) {
    throw new InputError("style.json dm source must use a pmtiles:// URL");
  }
  return parseRelativePath(value.slice("pmtiles://".length).replace(/^\.\//, ""), "pmtiles");
};

const parseStyleLevels = (metadata) => {
  if (Number.isInteger(metadata["dm:map-level"])) return [metadata["dm:map-level"]];
  return [2500];
};

const parseStyleSourceLayers = (style, metadata) => {
  if (Array.isArray(metadata["dm:sourceLayers"])) {
    return parseSourceLayers(metadata["dm:sourceLayers"]);
  }
  return parseSourceLayers([...new Set((style.layers ?? [])
    .filter(isRecord)
    .map((layer) => layer["source-layer"])
    .filter((layer) => typeof layer === "string" && !layer.startsWith("dm_default_")))]);
};

const isRecord = (value) => typeof value === "object" && Boolean(value) && !Array.isArray(value);
