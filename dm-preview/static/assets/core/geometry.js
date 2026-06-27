export const geometryBounds = (geometry) => {
  if (!geometry) return undefined;
  const points = [];
  collectGeometryPoints(geometry, points);
  if (points.length === 0) return undefined;
  let west = points[0][0];
  let south = points[0][1];
  let east = points[0][0];
  let north = points[0][1];
  for (const [x, y] of points) {
    west = Math.min(west, x);
    south = Math.min(south, y);
    east = Math.max(east, x);
    north = Math.max(north, y);
  }
  return [west, south, east, north];
};

export const featureCenter = (geometry) => {
  const bounds = geometryBounds(geometry);
  if (!bounds) return undefined;
  const [west, south, east, north] = bounds;
  return [(west + east) / 2, (south + north) / 2];
};

export const normalizeHighlightProperties = (properties) => {
  if ("ROTATION" in properties || !properties.ANGLE) return properties;
  return {...properties, ROTATION: properties.ANGLE};
};

export const toGeoJsonFeature = (feature) => ({
  type: "Feature",
  id: feature.id,
  geometry: feature.geometry,
  properties: normalizeHighlightProperties(feature.properties ?? {}),
});

const collectGeometryPoints = (geometry, points) => {
  if (!geometry) return;
  if (geometry.type === "Point") {
    points.push(geometry.coordinates);
    return;
  }
  if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
    points.push(...geometry.coordinates);
    return;
  }
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    for (const ringOrLine of geometry.coordinates) points.push(...ringOrLine);
    return;
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) points.push(...ring);
    }
  }
};
