import proj4 from "proj4";

const ORIGINS = [
  [33.0, 129.5],
  [33.0, 131.0],
  [36.0, 132.166666666667],
  [33.0, 133.5],
  [36.0, 134.333333333333],
  [36.0, 136.0],
  [36.0, 137.166666666667],
  [36.0, 138.5],
  [36.0, 139.833333333333],
  [40.0, 140.833333333333],
  [44.0, 140.25],
  [44.0, 142.25],
  [44.0, 144.25],
  [26.0, 142.0],
  [26.0, 127.5],
  [26.0, 124.0],
  [26.0, 131.0],
  [20.0, 136.0],
  [26.0, 154.0],
];

export const projectGeometry = (geometry, zone) => {
  if (geometry.type === "Point") return {...geometry, coordinates: projectPoint(geometry.coordinates, zone)};
  if (geometry.type === "LineString") {
    return {...geometry, coordinates: geometry.coordinates.map((point) => projectPoint(point, zone))};
  }
  return {
    ...geometry,
    coordinates: geometry.coordinates.map((ring) => ring.map((point) => projectPoint(point, zone))),
  };
};

const projectPoint = (point, zone) => {
  const [lat0, lon0] = ORIGINS[zone - 1];
  return proj4(
    `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +type=crs`,
    "WGS84",
    point,
  );
};
