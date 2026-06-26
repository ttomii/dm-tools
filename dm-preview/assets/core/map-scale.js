const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;
const TILE_SIZE = 512;
const STANDARD_DPI = 96;
const INCHES_PER_METER = 39.37;

export const getInitialCamera = (url, fallback) => {
  const coords = getCoords(url);
  const center = coords ?? fallback.slice(0, 2);
  const scale = getScale(url);
  return {
    center,
    zoom: scale === undefined ? fallback[2] : getZoomByScale(scale, center[1]),
  };
};

export const getCoords = (url) => {
  const value = url.searchParams.get("coords");
  if (!value) return undefined;
  const coords = value.split(",");
  if (coords.length !== 2) return undefined;
  const longitude = parseFloat(coords[0]);
  const latitude = parseFloat(coords[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return undefined;
  return [longitude, latitude];
};

export const getScale = (url) => {
  const value = url.searchParams.get("scale");
  if (!value) return undefined;
  const scale = parseInt(value, 10);
  return Number.isFinite(scale) && scale > 0 ? scale : undefined;
};

export const getZoomByScale = (scale, latitude) => {
  const groundResolution = scale / (STANDARD_DPI * INCHES_PER_METER);
  const projectedResolution = groundResolution / Math.cos(latitude * Math.PI / 180);
  return Math.log2(EARTH_CIRCUMFERENCE / (TILE_SIZE * projectedResolution));
};

export const getScaleByZoom = (zoom, latitude) => {
  const projectedResolution = EARTH_CIRCUMFERENCE / (TILE_SIZE * 2 ** zoom);
  const groundResolution = projectedResolution * Math.cos(latitude * Math.PI / 180);
  return Math.round(groundResolution * STANDARD_DPI * INCHES_PER_METER);
};
