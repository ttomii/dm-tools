const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;
const WKB_OFFSET = 40;

export class ApiInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ApiInputError";
    this.status = status;
  }
}

export const parseFeatureQuery = (query) => {
  const layer = parseLayer(query.get("layer"));
  const page = parsePositiveInteger(query.get("page"), "page", 1);
  const pageSize = parsePositiveInteger(query.get("pageSize"), "pageSize", PAGE_SIZE_DEFAULT);
  if (pageSize > PAGE_SIZE_MAX) throw new ApiInputError(`pageSize must be ${PAGE_SIZE_MAX} or less`);
  return {layer, page, pageSize};
};

export const parseGpkgTable = (tableName, geometryType, srsId) => {
  const match = /^dm_(\d+)_(polygon|line|point|text)_(\d{2})_(\d+)(?:_deco_(polygon|line|point))?$/.exec(tableName);
  if (!match) return undefined;
  const sourceKind = match[2];
  const kind = match[5] ?? geometryKindForSourceKind(sourceKind);
  if (kind !== geometryKind(geometryType)) return undefined;
  const zone = zoneFromSrsId(srsId);
  if (!zone) throw new ApiInputError(`unsupported GeoPackage layer SRS: ${tableName}`, 500);
  const sourceLayer = match[5] ? `dm_${match[1]}_${sourceKind}_deco_${match[5]}` : `dm_${match[1]}_${sourceKind}`;
  return {tableName, sourceLayer, kind, zone};
};

export const parseGeometry = (blob, kind) => {
  const reader = new BlobReader(blob);
  reader.offset = WKB_OFFSET;
  if (reader.length < WKB_OFFSET + 5 || reader.string(0, 2) !== "GP" || reader.u8() !== 1) {
    throw new ApiInputError("invalid GeoPackage geometry", 500);
  }
  const type = reader.u32();
  if (type !== expectedWkbType(kind)) throw new ApiInputError("unexpected GeoPackage geometry type", 500);
  if (type === 1) return {type: "Point", coordinates: reader.coordinate()};
  if (type === 2) return {type: "LineString", coordinates: reader.coordinates()};
  if (reader.u32() !== 1) throw new ApiInputError("multiple polygon rings are not supported", 500);
  return {type: "Polygon", coordinates: [reader.coordinates()]};
};

export const toFeature = ({table, row, geometry}) => {
  const bbox = bounds(geometry.coordinates);
  const properties = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "geom"));
  return {
    id: `${table.tableName}:${row.fid}`,
    tableName: table.tableName,
    fid: row.fid,
    sourceLayer: table.sourceLayer,
    geometry,
    bbox,
    center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    properties,
  };
};

const parseLayer = (value) => {
  if (!value || !/^dm_[0-9]+_(point|line|polygon|text)(?:_deco_(?:point|line|polygon))?$/.test(value)) {
    throw new ApiInputError("layer is required");
  }
  return value;
};

const parsePositiveInteger = (value, name, fallback) => {
  if (!value) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new ApiInputError(`${name} must be a positive integer`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) throw new ApiInputError(`${name} is too large`);
  return parsed;
};

const geometryKind = (name) => ({
  POLYGON: "polygon",
  LINESTRING: "line",
  POINT: "point",
}[String(name).toUpperCase()]);

const geometryKindForSourceKind = (kind) => kind === "text" ? "point" : kind;

const zoneFromSrsId = (srsId) => {
  const zone = Number(srsId) - 6668;
  return Number.isInteger(zone) && zone >= 1 && zone <= 19 ? zone : undefined;
};

const expectedWkbType = (kind) => kind === "polygon" ? 3 : kind === "line" ? 2 : 1;

const bounds = (coordinates) => flatCoordinates(coordinates).reduce(
  (bbox, point) => [
    Math.min(bbox[0], point[0]),
    Math.min(bbox[1], point[1]),
    Math.max(bbox[2], point[0]),
    Math.max(bbox[3], point[1]),
  ],
  [Infinity, Infinity, -Infinity, -Infinity],
);

const flatCoordinates = (coordinates) => typeof coordinates[0] === "number"
  ? [coordinates]
  : coordinates.flatMap(flatCoordinates);

class BlobReader {
  constructor(blob) {
    this.blob = blob;
    this.view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    this.length = blob.byteLength;
    this.offset = 0;
  }

  string(start, end) {
    return String.fromCharCode(...this.blob.slice(start, end));
  }

  u8() {
    return this.view.getUint8(this.offset++);
  }

  u32() {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f64() {
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  coordinate() {
    return [this.f64(), this.f64()];
  }

  coordinates() {
    return Array.from({length: this.u32()}, () => this.coordinate());
  }
}
